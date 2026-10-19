using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;
using TaskBoard.Api.Data;
using TaskBoard.Api.Domain;

namespace TaskBoard.Api.Services;

/// <summary>
/// Who may join the platform and who may start a workspace. Roles live inside workspaces, so the
/// rules lean on them, with one bootstrap exception: the first account, and the first workspace,
/// are always allowed so a fresh install can get going.
/// </summary>
public class PlatformRules(AppDbContext db, IOptions<SecurityOptions> security)
{
    public async Task<bool> CanCreateWorkspaceAsync(Guid userId)
    {
        if (!security.Value.RestrictWorkspaceCreation) return true;
        if (!await db.Workspaces.AnyAsync()) return true;
        return await db.WorkspaceMembers.AnyAsync(m => m.UserId == userId && m.Role >= WorkspaceRole.Admin);
    }

    /// <returns>null when the sign-up may go ahead, otherwise the reason to show.</returns>
    public async Task<string?> RegistrationBlockedAsync(string email, string? inviteToken)
    {
        if (!security.Value.InviteOnlyRegistration) return null;
        if (!await db.Users.AnyAsync()) return null;

        var invite = string.IsNullOrWhiteSpace(inviteToken) ? null
            : await db.Invitations.AsNoTracking().FirstOrDefaultAsync(i => i.Token == inviteToken);
        if (invite is null || invite.AcceptedAt != null || invite.ExpiresAt < DateTime.UtcNow)
            return "التسجيل في المنصة بالدعوة فقط. اطلب من المشرف يرسل لك رابط دعوة.";
        if (!string.Equals(invite.Email, email.Trim(), StringComparison.OrdinalIgnoreCase))
            return $"هذه الدعوة للبريد {invite.Email}. سجّل بنفس البريد.";
        return null;
    }
}
