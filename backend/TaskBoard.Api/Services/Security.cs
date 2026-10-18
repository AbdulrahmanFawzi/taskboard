using System.Security.Claims;
using Microsoft.AspNetCore.Identity;
using Microsoft.Extensions.Options;
using TaskBoard.Api.Domain;

namespace TaskBoard.Api.Services;

public class SecurityOptions
{
    /// <summary>When true, nothing but the 2FA enrolment endpoints works until the user turns 2FA on.</summary>
    public bool RequireTwoFactor { get; set; } = true;
    public string AuthenticatorIssuer { get; set; } = "TaskBoard";
    /// <summary>Sign-in attempts allowed per client IP per minute, across all sign-in endpoints.</summary>
    public int AuthRequestsPerMinute { get; set; } = 30;
}

public static class Policies
{
    /// <summary>Signed in, even if 2FA is not set up yet. Only the enrolment endpoints use this.</summary>
    public const string SignedIn = "SignedIn";
    public const string TwoFactorClaim = "tfa";
    public const string DisplayNameClaim = "name";
}

/// <summary>
/// Stamps the session with whether the user had 2FA on when it was issued. A full session for a
/// user with 2FA on can only come from passing the code or from a remembered device, so this one
/// claim is enough for the default policy to check.
/// </summary>
public class AppClaimsFactory(
    UserManager<AppUser> users,
    RoleManager<IdentityRole<Guid>> roles,
    IOptions<IdentityOptions> options)
    : UserClaimsPrincipalFactory<AppUser, IdentityRole<Guid>>(users, roles, options)
{
    protected override async Task<ClaimsIdentity> GenerateClaimsAsync(AppUser user)
    {
        var identity = await base.GenerateClaimsAsync(user);
        identity.AddClaim(new Claim(Policies.DisplayNameClaim, user.DisplayName));
        if (user.TwoFactorEnabled) identity.AddClaim(new Claim(Policies.TwoFactorClaim, "1"));
        return identity;
    }
}

/// <summary>
/// Cookie auth is only safe from CSRF if a cross-site page cannot send the request. SameSite=Strict
/// covers modern browsers; requiring a custom header (which a form post cannot set) covers the rest.
/// </summary>
public class CsrfHeaderMiddleware(RequestDelegate next)
{
    public const string HeaderName = "X-Requested-With";
    public const string HeaderValue = "taskboard";

    public Task InvokeAsync(HttpContext ctx)
    {
        var method = ctx.Request.Method;
        var unsafeMethod = !(HttpMethods.IsGet(method) || HttpMethods.IsHead(method) || HttpMethods.IsOptions(method));
        if (unsafeMethod && ctx.Request.Path.StartsWithSegments("/api")
            && ctx.Request.Headers[HeaderName] != HeaderValue)
        {
            ctx.Response.StatusCode = StatusCodes.Status400BadRequest;
            return ctx.Response.WriteAsJsonAsync(new { title = "الطلب ينقصه ترويسة مطلوبة." });
        }
        return next(ctx);
    }
}
