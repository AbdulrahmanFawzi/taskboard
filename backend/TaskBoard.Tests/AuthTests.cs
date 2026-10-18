using System.Net;
using TaskBoard.Api.Contracts;

namespace TaskBoard.Tests;

public class AuthTests(TestApp app) : IClassFixture<TestApp>
{
    [Fact]
    public async Task New_account_cannot_use_the_app_until_2fa_is_on()
    {
        var user = app.NewClient();
        var me = await user.RegisterAsync();
        Assert.False(me.TwoFactorEnabled);
        Assert.False(me.SessionVerified);

        User.Status(HttpStatusCode.Forbidden, await user.Http.GetAsync("/api/workspaces"));
        User.Status(HttpStatusCode.Forbidden, await user.Post("/api/workspaces", new { name = "Sneaky" }));

        await user.EnrollTwoFactorAsync();
        Assert.Equal(10, user.RecoveryCodes.Count);
        var after = await user.GetOk<MeResponse>("/api/auth/me");
        Assert.True(after.TwoFactorEnabled);
        Assert.True(after.SessionVerified);
        User.Status(HttpStatusCode.OK, await user.Http.GetAsync("/api/workspaces"));
    }

    [Fact]
    public async Task Enabling_2fa_rejects_a_wrong_code()
    {
        var user = app.NewClient();
        await user.RegisterAsync();
        await user.PostOk<TwoFactorSetupResponse>("/api/auth/2fa/setup", new { });
        User.Status(HttpStatusCode.BadRequest, await user.Post("/api/auth/2fa/enable", new { code = "000000" }));
    }

    [Fact]
    public async Task Password_alone_does_not_sign_in_once_2fa_is_on()
    {
        var first = await app.NewClient().SignUpAsync();

        var device = app.NewClient();
        var step1 = await device.PostOk<LoginResponse>("/api/auth/login", new { email = first.Email, password = first.Password });
        Assert.True(step1.RequiresTwoFactor);
        Assert.Null(step1.User);
        User.Status(HttpStatusCode.Unauthorized, await device.Http.GetAsync("/api/workspaces"));

        User.Status(HttpStatusCode.BadRequest, await device.Post("/api/auth/login/2fa", new { code = "123456" }));

        var step2 = await device.PostOk<LoginResponse>("/api/auth/login/2fa", new { code = first.Code(1) });
        Assert.True(step2.User!.SessionVerified);
        User.Status(HttpStatusCode.OK, await device.Http.GetAsync("/api/workspaces"));
    }

    [Fact]
    public async Task Recovery_codes_work_once()
    {
        var first = await app.NewClient().SignUpAsync();
        var code = first.RecoveryCodes[0];

        var a = app.NewClient();
        await a.PostOk<LoginResponse>("/api/auth/login", new { email = first.Email, password = first.Password });
        await a.PostOk<LoginResponse>("/api/auth/login/recovery", new { recoveryCode = code });
        var me = await a.GetOk<MeResponse>("/api/auth/me");
        Assert.Equal(9, me.RecoveryCodesLeft);

        var b = app.NewClient();
        await b.PostOk<LoginResponse>("/api/auth/login", new { email = first.Email, password = first.Password });
        User.Status(HttpStatusCode.BadRequest, await b.Post("/api/auth/login/recovery", new { recoveryCode = code }));
    }

    [Fact]
    public async Task Wrong_password_is_rejected_and_locks_out_after_five_tries()
    {
        var first = await app.NewClient().SignUpAsync();
        var other = app.NewClient();
        for (var i = 0; i < 4; i++)
            User.Status(HttpStatusCode.Unauthorized, await other.Post("/api/auth/login", new { email = first.Email, password = "wrong password!" }));
        User.Status((HttpStatusCode)423, await other.Post("/api/auth/login", new { email = first.Email, password = "wrong password!" }));
        // Even the right password is refused while locked.
        User.Status((HttpStatusCode)423, await other.Post("/api/auth/login", new { email = first.Email, password = first.Password }));
    }

    [Fact]
    public async Task Two_factor_cannot_be_turned_off_when_required()
    {
        var user = await app.NewClient().SignUpAsync();
        User.Status(HttpStatusCode.Forbidden, await user.Post("/api/auth/2fa/disable", new { code = user.Code(1) }));
    }

    [Fact]
    public async Task Duplicate_email_and_short_password_are_rejected()
    {
        var first = await app.NewClient().SignUpAsync();
        User.Status(HttpStatusCode.BadRequest, await app.NewClient().Post("/api/auth/register",
            new { email = first.Email, password = "another long password", displayName = "Copy" }));
        User.Status(HttpStatusCode.BadRequest, await app.NewClient().Post("/api/auth/register",
            new { email = "short@example.com", password = "short", displayName = "Short" }));
    }

    [Fact]
    public async Task Writes_without_the_csrf_header_are_refused()
    {
        var user = await app.NewClient().SignUpAsync();
        user.Http.DefaultRequestHeaders.Remove("X-Requested-With");
        User.Status(HttpStatusCode.BadRequest, await user.Post("/api/workspaces", new { name = "From another site" }));
    }

    [Fact]
    public async Task Logout_ends_the_session()
    {
        var user = await app.NewClient().SignUpAsync();
        User.Status(HttpStatusCode.NoContent, await user.Post("/api/auth/logout", new { }));
        User.Status(HttpStatusCode.Unauthorized, await user.Http.GetAsync("/api/auth/me"));
    }
}

public class StrictRateLimitApp : TestApp
{
    protected override int RateLimit => 3;
}

public class RateLimitTests(StrictRateLimitApp app) : IClassFixture<StrictRateLimitApp>
{
    [Fact]
    public async Task Sign_in_attempts_are_rate_limited()
    {
        var client = app.NewClient();
        for (var i = 0; i < 3; i++)
            User.Status(HttpStatusCode.Unauthorized, await client.Post("/api/auth/login", new { email = "nobody@example.com", password = "whatever-123" }));
        User.Status(HttpStatusCode.TooManyRequests, await client.Post("/api/auth/login", new { email = "nobody@example.com", password = "whatever-123" }));
    }
}
