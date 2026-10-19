using System.Text.Json.Serialization;
using System.Threading.RateLimiting;
using Microsoft.AspNetCore.Authentication.Cookies;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.AspNetCore.Diagnostics;
using Microsoft.AspNetCore.HttpOverrides;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using Oracle.EntityFrameworkCore.Infrastructure;
using TaskBoard.Api.Data;
using TaskBoard.Api.Domain;
using TaskBoard.Api.Hubs;
using TaskBoard.Api.Services;

// The runtime image has no curl, so the container health check calls the app itself.
if (args.Contains("--healthcheck"))
{
    using var probe = new HttpClient { Timeout = TimeSpan.FromSeconds(4) };
    try { return (await probe.GetAsync("http://127.0.0.1:8080/health")).IsSuccessStatusCode ? 0 : 1; }
    catch { return 1; }
}

var builder = WebApplication.CreateBuilder(args);
var config = builder.Configuration;

builder.Services.Configure<SecurityOptions>(config.GetSection("Security"));
var security = config.GetSection("Security").Get<SecurityOptions>() ?? new SecurityOptions();
var secureCookies = config.GetValue("Security:SecureCookies", !builder.Environment.IsDevelopment());

// ---- Database ----
var provider = config.GetValue("Database:Provider", "Oracle")!;
// Production runs on Oracle 19c. Pinning the SQL dialect keeps EF from emitting anything newer
// (such as the BOOLEAN type from 23ai), even when a developer points it at a newer server.
var oracleCompat = config.GetValue("Database:OracleSqlCompatibility", "19")!;
var connection = config.GetConnectionString("Default")
    ?? throw new InvalidOperationException("ConnectionStrings:Default is not set.");
builder.Services.AddDbContext<AppDbContext>(o =>
{
    if (provider.Equals("Sqlite", StringComparison.OrdinalIgnoreCase)) o.UseSqlite(connection);
    else o.UseOracle(connection, ora => ora.UseOracleSQLCompatibility(
        oracleCompat == "23" ? OracleSQLCompatibility.DatabaseVersion23 : OracleSQLCompatibility.DatabaseVersion19));
});

// ---- Identity, cookies and 2FA ----
builder.Services.AddIdentity<AppUser, IdentityRole<Guid>>(o =>
    {
        o.User.RequireUniqueEmail = true;
        o.Password.RequiredLength = 10;
        o.Password.RequiredUniqueChars = 4;
        o.Password.RequireDigit = false;
        o.Password.RequireLowercase = false;
        o.Password.RequireUppercase = false;
        o.Password.RequireNonAlphanumeric = false;
        o.Lockout.MaxFailedAccessAttempts = 5;
        o.Lockout.DefaultLockoutTimeSpan = TimeSpan.FromMinutes(10);
        o.Lockout.AllowedForNewUsers = true;
    })
    .AddEntityFrameworkStores<AppDbContext>()
    .AddDefaultTokenProviders()
    .AddClaimsPrincipalFactory<AppClaimsFactory>();

// Sessions re-check the security stamp, so turning 2FA on or resetting it ends other sessions soon.
builder.Services.Configure<SecurityStampValidatorOptions>(o => o.ValidationInterval = TimeSpan.FromMinutes(5));

void HardenCookie(CookieAuthenticationOptions o, string name)
{
    o.Cookie.Name = name;
    o.Cookie.HttpOnly = true;
    o.Cookie.SameSite = SameSiteMode.Strict;
    o.Cookie.SecurePolicy = secureCookies ? CookieSecurePolicy.Always : CookieSecurePolicy.SameAsRequest;
}
builder.Services.ConfigureApplicationCookie(o =>
{
    HardenCookie(o, "tb.session");
    o.ExpireTimeSpan = TimeSpan.FromDays(7);
    o.SlidingExpiration = true;
    // An API answers with status codes, not redirects to a login page.
    o.Events.OnRedirectToLogin = ctx => { ctx.Response.StatusCode = 401; return Task.CompletedTask; };
    o.Events.OnRedirectToAccessDenied = ctx => { ctx.Response.StatusCode = 403; return Task.CompletedTask; };
});
builder.Services.Configure<CookieAuthenticationOptions>(IdentityConstants.TwoFactorUserIdScheme,
    o => { HardenCookie(o, "tb.2fa"); o.ExpireTimeSpan = TimeSpan.FromMinutes(5); });
builder.Services.Configure<CookieAuthenticationOptions>(IdentityConstants.TwoFactorRememberMeScheme,
    o => { HardenCookie(o, "tb.device"); o.ExpireTimeSpan = TimeSpan.FromDays(30); });

builder.Services.AddAuthorizationBuilder()
    .AddPolicy(Policies.SignedIn, p => p.RequireAuthenticatedUser())
    .SetDefaultPolicy(security.RequireTwoFactor
        ? new Microsoft.AspNetCore.Authorization.AuthorizationPolicyBuilder()
            .RequireAuthenticatedUser().RequireClaim(Policies.TwoFactorClaim, "1").Build()
        : new Microsoft.AspNetCore.Authorization.AuthorizationPolicyBuilder().RequireAuthenticatedUser().Build());

builder.Services.AddDataProtection()
    .PersistKeysToDbContext<AppDbContext>()
    .SetApplicationName("TaskBoard");

builder.Services.AddRateLimiter(o =>
{
    o.RejectionStatusCode = StatusCodes.Status429TooManyRequests;
    o.AddPolicy("auth", ctx => RateLimitPartition.GetFixedWindowLimiter(
        ctx.Connection.RemoteIpAddress?.ToString() ?? "unknown",
        _ => new FixedWindowRateLimiterOptions { PermitLimit = security.AuthRequestsPerMinute, Window = TimeSpan.FromMinutes(1) }));
});

builder.Services.Configure<ForwardedHeadersOptions>(o =>
{
    o.ForwardedHeaders = ForwardedHeaders.XForwardedFor | ForwardedHeaders.XForwardedProto;
    // The API is only reachable through the reverse proxy on the private Docker network.
    o.KnownIPNetworks.Clear();
    o.KnownProxies.Clear();
});

// ---- App services ----
builder.Services.AddHttpContextAccessor();
builder.Services.AddScoped<WorkspaceAccess>();
builder.Services.AddScoped<ActivityLog>();
builder.Services.AddScoped<BoardOrdering>();
builder.Services.AddScoped<BoardEvents>();
builder.Services.AddScoped<Reports>();
builder.Services.AddScoped<SampleData>();
builder.Services.AddScoped<PlatformRules>();
builder.Services.AddSignalR();
// Every error body the browser sees carries an Arabic title, including the framework's own 401/403/404.
builder.Services.AddProblemDetails(o => o.CustomizeProblemDetails = ctx =>
{
    var arabic = ctx.ProblemDetails.Status switch
    {
        401 => "سجّل الدخول للمتابعة.",
        403 => "صلاحيتك لا تسمح بهذا الإجراء.",
        404 => "غير موجود.",
        429 => "محاولات كثيرة. انتظر دقيقة وحاول مرة ثانية.",
        _ => null,
    };
    // Keep titles our own code wrote; replace only the framework's English defaults.
    if (arabic is not null && (ctx.ProblemDetails.Title is null || ctx.ProblemDetails.Title.All(c => c < 128)))
        ctx.ProblemDetails.Title = arabic;
});
builder.Services.AddHealthChecks().AddDbContextCheck<AppDbContext>();
builder.Services.AddControllers()
    .AddJsonOptions(o => o.JsonSerializerOptions.Converters.Add(new JsonStringEnumConverter()))
    .ConfigureApiBehaviorOptions(o => o.InvalidModelStateResponseFactory = ctx =>
    {
        // Field names stay as keys so the form can point at them; the message the user reads is Arabic.
        var problem = new Microsoft.AspNetCore.Mvc.ValidationProblemDetails(ctx.ModelState)
        {
            Title = "تحقق من البيانات المدخلة.",
            Status = 400,
        };
        foreach (var key in problem.Errors.Keys.ToList()) problem.Errors[key] = ["قيمة هذا الحقل غير صالحة."];
        return new Microsoft.AspNetCore.Mvc.BadRequestObjectResult(problem);
    });

var app = builder.Build();

app.UseForwardedHeaders();
app.UseExceptionHandler(errors => errors.Run(async ctx =>
{
    var error = ctx.Features.Get<IExceptionHandlerFeature>()?.Error;
    var (status, title) = error switch
    {
        AccessDeniedException { NotMember: true } => (404, "غير موجود."),
        AccessDeniedException => (403, "صلاحيتك في مساحة العمل لا تسمح بهذا الإجراء."),
        BadHttpRequestException => (400, "الطلب غير صالح."),
        _ => (500, "حدث خطأ من جهتنا. حاول مرة ثانية."),
    };
    ctx.Response.StatusCode = status;
    await ctx.Response.WriteAsJsonAsync(new { title, status });
}));
app.UseStatusCodePages();

app.UseMiddleware<CsrfHeaderMiddleware>();
app.UseRateLimiter();
app.UseAuthentication();
app.UseAuthorization();

app.MapControllers();
app.MapHub<BoardHub>("/hubs/board");
app.MapHealthChecks("/health");

using (var scope = app.Services.CreateScope())
{
    var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
    var startupLog = scope.ServiceProvider.GetRequiredService<ILogger<Program>>();

    // The database server may still be starting, or briefly down for maintenance. Wait for it
    // instead of failing; if it never answers, exit so the container restarts cleanly.
    var attempts = config.GetValue("Database:StartupRetries", 30);
    for (var attempt = 1; !db.Database.IsSqlite(); attempt++)
    {
        try
        {
            if (await db.Database.CanConnectAsync()) break;
        }
        catch (Exception e) when (attempt < attempts)
        {
            startupLog.LogWarning("Database not reachable yet (attempt {Attempt}/{Max}): {Error}", attempt, attempts, e.Message);
        }
        catch (Exception e)
        {
            startupLog.LogCritical(e, "Database not reachable after {Max} attempts; exiting", attempts);
            return 1;
        }
        if (attempt >= attempts)
        {
            startupLog.LogCritical("Database not reachable after {Max} attempts; exiting", attempts);
            return 1;
        }
        await Task.Delay(TimeSpan.FromSeconds(5));
    }

    if (db.Database.IsSqlite()) await db.Database.EnsureCreatedAsync();
    // DBAs often apply schema changes themselves from deploy/oracle/schema.sql; then this is off.
    else if (config.GetValue("Database:ApplyMigrations", true)) await db.Database.MigrateAsync();
}

await app.RunAsync();
return 0;

public partial class Program;
