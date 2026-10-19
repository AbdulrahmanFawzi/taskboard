using System.Text.Encodings.Web;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.Extensions.Options;
using TaskBoard.Api.Contracts;
using TaskBoard.Api.Domain;
using TaskBoard.Api.Services;

namespace TaskBoard.Api.Controllers;

[ApiController]
[Route("api/auth")]
public class AuthController(
    UserManager<AppUser> users,
    SignInManager<AppUser> signIn,
    IOptions<SecurityOptions> security,
    PlatformRules rules,
    ILogger<AuthController> log) : ControllerBase
{
    private static readonly string[] AvatarColors =
        ["#175cd3", "#1b8354", "#e04f16", "#6938ef", "#dd2590", "#0e9384", "#b87b02", "#d92c20"];

    [HttpPost("register")]
    [EnableRateLimiting("auth")]
    public async Task<ActionResult<MeResponse>> Register(RegisterRequest req)
    {
        if (await rules.RegistrationBlockedAsync(req.Email, req.InviteToken) is { } reason)
            return Problem(reason, statusCode: 403);

        var user = new AppUser
        {
            UserName = req.Email.Trim(),
            Email = req.Email.Trim(),
            DisplayName = req.DisplayName.Trim(),
            AvatarColor = AvatarColors[Random.Shared.Next(AvatarColors.Length)],
        };
        var result = await users.CreateAsync(user, req.Password);
        if (!result.Succeeded) return IdentityProblem(result);

        await signIn.SignInAsync(user, isPersistent: false);
        log.LogInformation("User {UserId} registered", user.Id);
        return await MeFor(user, sessionVerified: false);
    }

    [HttpPost("login")]
    [EnableRateLimiting("auth")]
    public async Task<ActionResult<LoginResponse>> Login(LoginRequest req)
    {
        var user = await users.FindByEmailAsync(req.Email.Trim());
        if (user is null) return InvalidLogin();

        var result = await signIn.PasswordSignInAsync(user, req.Password, req.RememberMe, lockoutOnFailure: true);
        if (result.RequiresTwoFactor) return new LoginResponse(true, null);
        if (result.IsLockedOut) return LockedOut();
        if (!result.Succeeded) return InvalidLogin();

        return new LoginResponse(false, await MeFor(user, sessionVerified: user.TwoFactorEnabled));
    }

    [HttpPost("login/2fa")]
    [EnableRateLimiting("auth")]
    public async Task<ActionResult<LoginResponse>> LoginTwoFactor(TwoFactorLoginRequest req)
    {
        var user = await signIn.GetTwoFactorAuthenticationUserAsync();
        if (user is null) return SessionExpired();

        var code = NormalizeCode(req.Code);
        // The password step already set the persistence choice; the 2FA cookie remembers it.
        var result = await signIn.TwoFactorAuthenticatorSignInAsync(code, isPersistent: false, req.RememberMachine);
        if (result.IsLockedOut) return LockedOut();
        if (!result.Succeeded) return Problem("الرمز غير صحيح. الرموز تتغير كل 30 ثانية.", statusCode: 400);

        return new LoginResponse(false, await MeFor(user, sessionVerified: true));
    }

    [HttpPost("login/recovery")]
    [EnableRateLimiting("auth")]
    public async Task<ActionResult<LoginResponse>> LoginRecovery(RecoveryLoginRequest req)
    {
        var user = await signIn.GetTwoFactorAuthenticationUserAsync();
        if (user is null) return SessionExpired();

        var result = await signIn.TwoFactorRecoveryCodeSignInAsync(req.RecoveryCode.Replace(" ", ""));
        if (result.IsLockedOut) return LockedOut();
        if (!result.Succeeded) return Problem("رمز الاسترداد غير صالح أو استُخدم من قبل.", statusCode: 400);

        log.LogWarning("User {UserId} signed in with a recovery code", user.Id);
        return new LoginResponse(false, await MeFor(user, sessionVerified: true));
    }

    [HttpPost("logout")]
    [Authorize(Policy = Policies.SignedIn)]
    public async Task<IActionResult> Logout()
    {
        await signIn.SignOutAsync();
        return NoContent();
    }

    [HttpGet("me")]
    [Authorize(Policy = Policies.SignedIn)]
    public async Task<ActionResult<MeResponse>> Me()
    {
        var user = await users.GetUserAsync(User);
        if (user is null) return Unauthorized();
        return await MeFor(user, sessionVerified: User.HasClaim(Policies.TwoFactorClaim, "1"));
    }

    // ---- Enrolment: reachable before 2FA is on, so these use the SignedIn policy. ----

    [HttpPost("2fa/setup")]
    [Authorize(Policy = Policies.SignedIn)]
    public async Task<ActionResult<TwoFactorSetupResponse>> SetupTwoFactor()
    {
        var user = await users.GetUserAsync(User);
        if (user is null) return Unauthorized();
        if (user.TwoFactorEnabled) return Problem("التحقق الثنائي مفعّل مسبقًا.", statusCode: 409);

        // A fresh key each time setup opens, so a key shown on a screen earlier cannot be reused.
        await users.ResetAuthenticatorKeyAsync(user);
        var key = await users.GetAuthenticatorKeyAsync(user) ?? throw new InvalidOperationException("No authenticator key.");

        var issuer = security.Value.AuthenticatorIssuer;
        var uri = $"otpauth://totp/{UrlEncoder.Default.Encode(issuer)}:{UrlEncoder.Default.Encode(user.Email!)}" +
                  $"?secret={key}&issuer={UrlEncoder.Default.Encode(issuer)}&digits=6";
        return new TwoFactorSetupResponse(FormatKey(key), uri);
    }

    [HttpPost("2fa/enable")]
    [EnableRateLimiting("auth")]
    [Authorize(Policy = Policies.SignedIn)]
    public async Task<ActionResult<RecoveryCodesResponse>> EnableTwoFactor(CodeRequest req)
    {
        var user = await users.GetUserAsync(User);
        if (user is null) return Unauthorized();
        if (user.TwoFactorEnabled) return Problem("التحقق الثنائي مفعّل مسبقًا.", statusCode: 409);

        var valid = await users.VerifyTwoFactorTokenAsync(
            user, users.Options.Tokens.AuthenticatorTokenProvider, NormalizeCode(req.Code));
        if (!valid) return Problem("الرمز غير صحيح. تأكد من ضبط الوقت في جوالك وجرّب أحدث رمز.", statusCode: 400);

        await users.SetTwoFactorEnabledAsync(user, true);
        var codes = await users.GenerateNewTwoFactorRecoveryCodesAsync(user, 10) ?? [];
        // Re-issue the cookie so it carries the 2FA claim; the security stamp change logs out other sessions.
        await signIn.RefreshSignInAsync(user);
        log.LogInformation("User {UserId} turned on 2FA", user.Id);
        return new RecoveryCodesResponse(codes.ToList());
    }

    [HttpPost("2fa/recovery-codes")]
    [Authorize]
    public async Task<ActionResult<RecoveryCodesResponse>> RegenerateRecoveryCodes(CodeRequest req)
    {
        var user = await users.GetUserAsync(User);
        if (user is null) return Unauthorized();
        var valid = await users.VerifyTwoFactorTokenAsync(
            user, users.Options.Tokens.AuthenticatorTokenProvider, NormalizeCode(req.Code));
        if (!valid) return Problem("الرمز غير صحيح.", statusCode: 400);

        var codes = await users.GenerateNewTwoFactorRecoveryCodesAsync(user, 10) ?? [];
        return new RecoveryCodesResponse(codes.ToList());
    }

    [HttpPost("2fa/disable")]
    [Authorize]
    public async Task<IActionResult> DisableTwoFactor(CodeRequest req)
    {
        if (security.Value.RequireTwoFactor)
            return Problem("التحقق الثنائي إلزامي في هذه المنصة ولا يمكن إيقافه.", statusCode: 403);

        var user = await users.GetUserAsync(User);
        if (user is null) return Unauthorized();
        var valid = await users.VerifyTwoFactorTokenAsync(
            user, users.Options.Tokens.AuthenticatorTokenProvider, NormalizeCode(req.Code));
        if (!valid) return Problem("الرمز غير صحيح.", statusCode: 400);

        await users.SetTwoFactorEnabledAsync(user, false);
        await users.ResetAuthenticatorKeyAsync(user);
        await signIn.RefreshSignInAsync(user);
        return NoContent();
    }

    private async Task<MeResponse> MeFor(AppUser user, bool sessionVerified) => new(
        user.Id, user.Email!, user.DisplayName, user.AvatarColor,
        user.TwoFactorEnabled, security.Value.RequireTwoFactor,
        sessionVerified || !security.Value.RequireTwoFactor,
        user.TwoFactorEnabled ? await users.CountRecoveryCodesAsync(user) : 0,
        await rules.CanCreateWorkspaceAsync(user.Id));

    private static string NormalizeCode(string code) => code.Replace(" ", "").Replace("-", "");

    private static string FormatKey(string key) =>
        string.Join(' ', Enumerable.Range(0, (key.Length + 3) / 4)
            .Select(i => key.Substring(i * 4, Math.Min(4, key.Length - i * 4)))).ToLowerInvariant();

    private ObjectResult InvalidLogin() => Problem("البريد الإلكتروني أو كلمة المرور غير صحيحة.", statusCode: 401);
    private ObjectResult LockedOut() => Problem("محاولات كثيرة. حاول مرة ثانية بعد دقائق.", statusCode: 423);
    private ObjectResult SessionExpired() => Problem("انتهت مهلة خطوة الدخول. أدخل كلمة المرور مرة ثانية.", statusCode: 401);

    private ActionResult IdentityProblem(IdentityResult result)
    {
        foreach (var e in result.Errors) ModelState.AddModelError(e.Code, e.Description);
        return ValidationProblem(ModelState);
    }
}
