using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using System.Text.Json.Serialization;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Data.Sqlite;
using OtpNet;
using TaskBoard.Api.Contracts;

namespace TaskBoard.Tests;

/// <summary>The real app on a private in-memory SQLite database, one per test class.</summary>
public class TestApp : WebApplicationFactory<Program>
{
    private readonly string _db = $"Data Source=file:tb{Guid.NewGuid():N}?mode=memory&cache=shared";
    private readonly SqliteConnection _keepAlive;
    protected virtual int RateLimit => 100_000;
    protected virtual bool StrictPlatform => false;

    public TestApp()
    {
        // A shared in-memory database lives only while at least one connection is open.
        _keepAlive = new SqliteConnection(_db);
        _keepAlive.Open();
    }

    protected override void ConfigureWebHost(IWebHostBuilder builder)
    {
        builder.UseEnvironment("Testing");
        builder.UseSetting("Database:Provider", "Sqlite");
        builder.UseSetting("ConnectionStrings:Default", _db);
        builder.UseSetting("Security:RequireTwoFactor", "true");
        // Every test client shares one address; the limiter itself has its own test below.
        builder.UseSetting("Security:AuthRequestsPerMinute", RateLimit.ToString());
        // Most tests sign up many users without invitations; the platform rules have their own tests.
        builder.UseSetting("Security:InviteOnlyRegistration", StrictPlatform.ToString());
        builder.UseSetting("Security:RestrictWorkspaceCreation", StrictPlatform.ToString());
    }

    public User NewClient()
    {
        var client = CreateClient(new WebApplicationFactoryClientOptions { BaseAddress = new Uri("https://localhost") });
        client.DefaultRequestHeaders.Add("X-Requested-With", "taskboard");
        return new User(client);
    }

    protected override void Dispose(bool disposing)
    {
        base.Dispose(disposing);
        _keepAlive.Dispose();
    }
}

public class User(HttpClient http)
{
    public static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web)
    {
        Converters = { new JsonStringEnumConverter() },
    };

    public HttpClient Http { get; } = http;
    public string Email { get; private set; } = "";
    public string Password { get; } = "correct horse battery";
    public string AuthenticatorKey { get; private set; } = "";
    public IReadOnlyList<string> RecoveryCodes { get; private set; } = [];
    public Guid Id { get; private set; }

    /// <summary>Registers and turns on 2FA, which is what every real user has to do first.</summary>
    public async Task<User> SignUpAsync(string? email = null)
    {
        await RegisterAsync(email);
        await EnrollTwoFactorAsync();
        return this;
    }

    public async Task<MeResponse> RegisterAsync(string? email = null, string? inviteToken = null)
    {
        Email = email ?? $"u{Guid.NewGuid():N}@example.com";
        var me = await PostOk<MeResponse>("/api/auth/register", new { email = Email, password = Password, displayName = "Test User", inviteToken });
        Id = me.Id;
        return me;
    }

    public async Task EnrollTwoFactorAsync()
    {
        var setup = await PostOk<TwoFactorSetupResponse>("/api/auth/2fa/setup", new { });
        AuthenticatorKey = setup.SharedKey.Replace(" ", "").ToUpperInvariant();
        var codes = await PostOk<RecoveryCodesResponse>("/api/auth/2fa/enable", new { code = Code() });
        RecoveryCodes = codes.RecoveryCodes;
    }

    /// <param name="stepOffset">Which 30-second window to use; later windows avoid any one-time-use check.</param>
    public string Code(int stepOffset = 0) =>
        new Totp(Base32Encoding.ToBytes(AuthenticatorKey)).ComputeTotp(DateTime.UtcNow.AddSeconds(30 * stepOffset));

    public Task<HttpResponseMessage> Post(string url, object body) => Http.PostAsJsonAsync(url, body, Json);
    public Task<HttpResponseMessage> Patch(string url, object body) => Http.PatchAsJsonAsync(url, body, Json);

    public async Task<T> PostOk<T>(string url, object body)
    {
        var res = await Post(url, body);
        await EnsureOk(res);
        return (await res.Content.ReadFromJsonAsync<T>(Json))!;
    }

    public async Task<T> PatchOk<T>(string url, object body)
    {
        var res = await Patch(url, body);
        await EnsureOk(res);
        return (await res.Content.ReadFromJsonAsync<T>(Json))!;
    }

    public async Task<T> GetOk<T>(string url)
    {
        var res = await Http.GetAsync(url);
        await EnsureOk(res);
        return (await res.Content.ReadFromJsonAsync<T>(Json))!;
    }

    private static async Task EnsureOk(HttpResponseMessage res)
    {
        if (!res.IsSuccessStatusCode)
            throw new HttpRequestException($"{(int)res.StatusCode} {res.RequestMessage?.RequestUri}: {await res.Content.ReadAsStringAsync()}",
                null, res.StatusCode);
    }

    public static void Status(HttpStatusCode expected, HttpResponseMessage res) =>
        Assert.True(res.StatusCode == expected, $"Expected {expected}, got {res.StatusCode}: {res.Content.ReadAsStringAsync().Result}");
}
