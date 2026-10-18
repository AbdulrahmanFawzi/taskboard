using System.Security.Cryptography;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using TaskBoard.Api.Contracts;
using TaskBoard.Api.Data;
using TaskBoard.Api.Domain;
using TaskBoard.Api.Hubs;
using TaskBoard.Api.Services;

namespace TaskBoard.Api.Controllers;

[ApiController]
[Authorize]
[Route("api/workspaces")]
public class WorkspacesController(
    AppDbContext db, WorkspaceAccess access, ActivityLog activity, BoardEvents events, SampleData sample)
    : ControllerBase
{
    [HttpGet]
    public async Task<IReadOnlyList<WorkspaceSummary>> List()
    {
        var me = access.UserId;
        return await db.WorkspaceMembers.Where(m => m.UserId == me)
            .OrderBy(m => m.JoinedAt)
            .Select(m => new WorkspaceSummary(m.WorkspaceId, m.Workspace.Name, m.Workspace.AccentColor, m.Role,
                m.Workspace.Members.Count))
            .ToListAsync();
    }

    [HttpPost]
    public async Task<ActionResult<WorkspaceDetail>> Create(CreateWorkspaceRequest req)
    {
        var me = access.UserId;
        var ws = new Workspace { Name = req.Name.Trim() };
        ws.Members.Add(new WorkspaceMember { UserId = me, Role = WorkspaceRole.Owner });
        ws.Columns.AddRange(DefaultColumns());
        db.Workspaces.Add(ws);
        activity.Add(ws.Id, me, "workspace.created", $"أنشأ مساحة العمل {ws.Name}");
        await db.SaveChangesAsync();

        if (req.WithSampleData) await sample.FillAsync(ws.Id, me);
        return CreatedAtAction(nameof(Get), new { id = ws.Id }, await Detail(ws.Id, WorkspaceRole.Owner));
    }

    [HttpGet("{id:guid}")]
    public async Task<WorkspaceDetail> Get(Guid id) => await Detail(id, await access.RequireAsync(id));

    [HttpPatch("{id:guid}")]
    public async Task<WorkspaceDetail> Update(Guid id, UpdateWorkspaceRequest req)
    {
        var role = await access.RequireAsync(id, WorkspaceRole.Admin);
        var ws = await db.Workspaces.FirstAsync(w => w.Id == id);
        if (req.Name is not null) ws.Name = req.Name.Trim();
        if (req.AccentColor is not null) ws.AccentColor = req.AccentColor.ToLowerInvariant();
        await db.SaveChangesAsync();
        await events.ChangedAsync(id, "workspace");
        return await Detail(id, role);
    }

    [HttpDelete("{id:guid}")]
    public async Task<IActionResult> Delete(Guid id)
    {
        await access.RequireAsync(id, WorkspaceRole.Owner);
        // Tasks restrict column deletes, so clear them first; the rest cascades from the workspace.
        await db.Tasks.Where(t => t.WorkspaceId == id).ExecuteDeleteAsync();
        await db.Workspaces.Where(w => w.Id == id).ExecuteDeleteAsync();
        return NoContent();
    }

    // ---- Columns ----

    [HttpPost("{id:guid}/columns")]
    public async Task<ActionResult<ColumnDto>> AddColumn(Guid id, CreateColumnRequest req)
    {
        await access.RequireAsync(id, WorkspaceRole.Admin);
        var count = await db.Columns.CountAsync(c => c.WorkspaceId == id);
        if (count >= 12) return Problem("الحد الأقصى للوحة 12 عمودًا.", statusCode: 400);
        var col = new BoardColumn { WorkspaceId = id, Name = req.Name.Trim(), Kind = req.Kind, Position = count };
        db.Columns.Add(col);
        await db.SaveChangesAsync();
        await events.ChangedAsync(id, "workspace");
        return col.ToDto();
    }

    [HttpPatch("{id:guid}/columns/{columnId:guid}")]
    public async Task<ActionResult<IReadOnlyList<ColumnDto>>> UpdateColumn(Guid id, Guid columnId, UpdateColumnRequest req)
    {
        await access.RequireAsync(id, WorkspaceRole.Admin);
        var columns = await db.Columns.Where(c => c.WorkspaceId == id).OrderBy(c => c.Position).ToListAsync();
        var col = columns.FirstOrDefault(c => c.Id == columnId);
        if (col is null) return NotFound();

        if (req.Name is not null) col.Name = req.Name.Trim();
        if (req.Kind is not null && req.Kind != col.Kind)
        {
            col.Kind = req.Kind.Value;
            var tasks = await db.Tasks.Where(t => t.ColumnId == col.Id).ToListAsync();
            foreach (var t in tasks) BoardOrdering.ApplyLifecycle(t, col.Kind);
        }
        if (req.Position is not null)
        {
            columns.Remove(col);
            columns.Insert(Math.Clamp(req.Position.Value, 0, columns.Count), col);
            for (var i = 0; i < columns.Count; i++) columns[i].Position = i;
        }
        await db.SaveChangesAsync();
        await events.ChangedAsync(id, "workspace");
        return columns.Select(c => c.ToDto()).ToList();
    }

    [HttpDelete("{id:guid}/columns/{columnId:guid}")]
    public async Task<IActionResult> DeleteColumn(Guid id, Guid columnId)
    {
        await access.RequireAsync(id, WorkspaceRole.Admin);
        var col = await db.Columns.FirstOrDefaultAsync(c => c.Id == columnId && c.WorkspaceId == id);
        if (col is null) return NotFound();
        if (await db.Tasks.AnyAsync(t => t.ColumnId == columnId))
            return Problem("انقل بطاقات هذا العمود أو احذفها أولًا.", statusCode: 409);
        if (await db.Columns.CountAsync(c => c.WorkspaceId == id) <= 1)
            return Problem("اللوحة تحتاج عمودًا واحدًا على الأقل.", statusCode: 409);

        db.Columns.Remove(col);
        await db.SaveChangesAsync();
        var rest = await db.Columns.Where(c => c.WorkspaceId == id).OrderBy(c => c.Position).ToListAsync();
        for (var i = 0; i < rest.Count; i++) rest[i].Position = i;
        await db.SaveChangesAsync();
        await events.ChangedAsync(id, "workspace");
        return NoContent();
    }

    // ---- Projects ----

    [HttpPost("{id:guid}/projects")]
    public async Task<ActionResult<ProjectDto>> AddProject(Guid id, CreateProjectRequest req)
    {
        await access.RequireAsync(id, WorkspaceRole.Member);
        var project = new Project { WorkspaceId = id, Name = req.Name.Trim(), Color = req.Color ?? "#175cd3" };
        db.Projects.Add(project);
        activity.Add(id, access.UserId, "project.created", $"أنشأ المشروع {project.Name}");
        await db.SaveChangesAsync();
        await events.ChangedAsync(id, "workspace");
        return project.ToDto();
    }

    [HttpPatch("{id:guid}/projects/{projectId:guid}")]
    public async Task<ActionResult<ProjectDto>> UpdateProject(Guid id, Guid projectId, UpdateProjectRequest req)
    {
        await access.RequireAsync(id, WorkspaceRole.Admin);
        var project = await db.Projects.FirstOrDefaultAsync(p => p.Id == projectId && p.WorkspaceId == id);
        if (project is null) return NotFound();
        if (req.Name is not null) project.Name = req.Name.Trim();
        if (req.Color is not null) project.Color = req.Color;
        await db.SaveChangesAsync();
        await events.ChangedAsync(id, "workspace");
        return project.ToDto();
    }

    [HttpDelete("{id:guid}/projects/{projectId:guid}")]
    public async Task<IActionResult> DeleteProject(Guid id, Guid projectId)
    {
        await access.RequireAsync(id, WorkspaceRole.Admin);
        var project = await db.Projects.FirstOrDefaultAsync(p => p.Id == projectId && p.WorkspaceId == id);
        if (project is null) return NotFound();
        await db.Tasks.Where(t => t.ProjectId == projectId).ExecuteUpdateAsync(s => s.SetProperty(t => t.ProjectId, (Guid?)null));
        db.Projects.Remove(project);
        await db.SaveChangesAsync();
        await events.ChangedAsync(id, "workspace");
        return NoContent();
    }

    // ---- Members ----

    [HttpPatch("{id:guid}/members/{userId:guid}")]
    public async Task<IActionResult> UpdateMember(Guid id, Guid userId, UpdateMemberRequest req)
    {
        var myRole = await access.RequireAsync(id, WorkspaceRole.Admin);
        var member = await db.WorkspaceMembers.FirstOrDefaultAsync(m => m.WorkspaceId == id && m.UserId == userId);
        if (member is null) return NotFound();
        if (!Enum.IsDefined(req.Role)) return Problem("صلاحية غير معروفة.", statusCode: 400);

        // Admins manage members and viewers; only the owner can hand out or take away Admin and Owner.
        var touchesTopRoles = member.Role >= WorkspaceRole.Admin || req.Role >= WorkspaceRole.Admin;
        if (touchesTopRoles && myRole != WorkspaceRole.Owner)
            return Problem("تغيير صلاحيات المشرفين متاح للمالك فقط.", statusCode: 403);
        if (member.Role == WorkspaceRole.Owner && req.Role != WorkspaceRole.Owner
            && await db.WorkspaceMembers.CountAsync(m => m.WorkspaceId == id && m.Role == WorkspaceRole.Owner) == 1)
            return Problem("مساحة العمل تحتاج مالكًا واحدًا على الأقل.", statusCode: 409);

        member.Role = req.Role;
        await db.SaveChangesAsync();
        await events.ChangedAsync(id, "members");
        return NoContent();
    }

    [HttpDelete("{id:guid}/members/{userId:guid}")]
    public async Task<IActionResult> RemoveMember(Guid id, Guid userId)
    {
        var leavingSelf = userId == access.UserId;
        var myRole = await access.RequireAsync(id, leavingSelf ? WorkspaceRole.Viewer : WorkspaceRole.Admin);
        var member = await db.WorkspaceMembers.FirstOrDefaultAsync(m => m.WorkspaceId == id && m.UserId == userId);
        if (member is null) return NotFound();
        if (!leavingSelf && member.Role >= myRole)
            return Problem("تقدر تزيل الأشخاص اللي صلاحيتهم أقل من صلاحيتك فقط.", statusCode: 403);
        if (member.Role == WorkspaceRole.Owner
            && await db.WorkspaceMembers.CountAsync(m => m.WorkspaceId == id && m.Role == WorkspaceRole.Owner) == 1)
            return Problem("انقل الملكية لشخص ثاني قبل المغادرة.", statusCode: 409);

        db.WorkspaceMembers.Remove(member);
        await db.TaskAssignees.Where(a => a.UserId == userId && db.Tasks.Any(t => t.Id == a.TaskId && t.WorkspaceId == id))
            .ExecuteDeleteAsync();
        await db.SaveChangesAsync();
        await events.ChangedAsync(id, "members");
        return NoContent();
    }

    // ---- Invitations ----

    [HttpGet("{id:guid}/invitations")]
    public async Task<IReadOnlyList<InvitationDto>> Invitations(Guid id)
    {
        await access.RequireAsync(id, WorkspaceRole.Admin);
        return await db.Invitations.Where(i => i.WorkspaceId == id && i.AcceptedAt == null)
            .OrderByDescending(i => i.CreatedAt)
            .Select(i => new InvitationDto(i.Id, i.Email, i.Role, i.Token, i.ExpiresAt, i.CreatedAt))
            .ToListAsync();
    }

    [HttpPost("{id:guid}/invitations")]
    public async Task<ActionResult<InvitationDto>> Invite(Guid id, CreateInvitationRequest req)
    {
        var myRole = await access.RequireAsync(id, WorkspaceRole.Admin);
        if (req.Role >= WorkspaceRole.Owner || (req.Role == WorkspaceRole.Admin && myRole != WorkspaceRole.Owner))
            return Problem("ما تقدر تدعو أحد بهذه الصلاحية.", statusCode: 403);

        var email = req.Email.Trim().ToLowerInvariant();
        var alreadyMember = await db.WorkspaceMembers
            .AnyAsync(m => m.WorkspaceId == id && m.User.NormalizedEmail == email.ToUpperInvariant());
        if (alreadyMember) return Problem("هذا الشخص موجود في مساحة العمل مسبقًا.", statusCode: 409);

        var invite = new Invitation
        {
            WorkspaceId = id,
            Email = email,
            Role = req.Role,
            Token = Convert.ToHexString(RandomNumberGenerator.GetBytes(24)).ToLowerInvariant(),
            InvitedById = access.UserId,
            ExpiresAt = DateTime.UtcNow.AddDays(7),
        };
        db.Invitations.Add(invite);
        await db.SaveChangesAsync();
        return new InvitationDto(invite.Id, invite.Email, invite.Role, invite.Token, invite.ExpiresAt, invite.CreatedAt);
    }

    [HttpDelete("{id:guid}/invitations/{inviteId:guid}")]
    public async Task<IActionResult> RevokeInvite(Guid id, Guid inviteId)
    {
        await access.RequireAsync(id, WorkspaceRole.Admin);
        await db.Invitations.Where(i => i.Id == inviteId && i.WorkspaceId == id).ExecuteDeleteAsync();
        return NoContent();
    }

    private async Task<WorkspaceDetail> Detail(Guid id, WorkspaceRole role)
    {
        var ws = await db.Workspaces.AsNoTracking().FirstAsync(w => w.Id == id);
        var columns = await db.Columns.Where(c => c.WorkspaceId == id).OrderBy(c => c.Position)
            .Select(c => new ColumnDto(c.Id, c.Name, c.Kind, c.Position)).ToListAsync();
        var projects = await db.Projects.Where(p => p.WorkspaceId == id).OrderBy(p => p.CreatedAt)
            .Select(p => new ProjectDto(p.Id, p.Name, p.Color)).ToListAsync();
        var members = await db.WorkspaceMembers.Where(m => m.WorkspaceId == id)
            .OrderByDescending(m => m.Role).ThenBy(m => m.User.DisplayName)
            .Select(m => new MemberDto(m.UserId, m.User.DisplayName, m.User.Email!, m.User.AvatarColor, m.Role, m.JoinedAt))
            .ToListAsync();
        return new WorkspaceDetail(ws.Id, ws.Name, ws.AccentColor, role, columns, projects, members);
    }

    private static IEnumerable<BoardColumn> DefaultColumns() =>
    [
        new() { Name = "قائمة المهام", Kind = ColumnKind.Todo, Position = 0 },
        new() { Name = "قيد التنفيذ", Kind = ColumnKind.InProgress, Position = 1 },
        new() { Name = "قيد المراجعة", Kind = ColumnKind.Review, Position = 2 },
        new() { Name = "مكتملة", Kind = ColumnKind.Done, Position = 3 },
    ];
}

[ApiController]
[Route("api/invitations")]
public class InvitationsController(AppDbContext db, UserManager<AppUser> users, ActivityLog activity, BoardEvents events)
    : ControllerBase
{
    /// <summary>Lets the invite page show what is being joined before the person signs in.</summary>
    [HttpGet("{token}")]
    [AllowAnonymous]
    public async Task<ActionResult<InvitationPreview>> Preview(string token)
    {
        var invite = await db.Invitations.Include(i => i.Workspace).AsNoTracking().FirstOrDefaultAsync(i => i.Token == token);
        if (invite is null) return NotFound();
        return new InvitationPreview(invite.Workspace.Name, invite.Email, invite.Role,
            invite.ExpiresAt < DateTime.UtcNow, invite.AcceptedAt != null);
    }

    [HttpPost("{token}/accept")]
    [Authorize]
    public async Task<ActionResult<WorkspaceSummary>> Accept(string token)
    {
        var user = await users.GetUserAsync(User);
        if (user is null) return Unauthorized();
        var invite = await db.Invitations.Include(i => i.Workspace).FirstOrDefaultAsync(i => i.Token == token);
        if (invite is null) return NotFound();
        if (invite.AcceptedAt != null) return Problem("هذه الدعوة استُخدمت من قبل.", statusCode: 409);
        if (invite.ExpiresAt < DateTime.UtcNow) return Problem("انتهت صلاحية الدعوة. اطلب دعوة جديدة.", statusCode: 410);
        if (!string.Equals(invite.Email, user.Email, StringComparison.OrdinalIgnoreCase))
            return Problem($"هذه الدعوة للبريد {invite.Email}. سجّل الدخول به عشان تقبلها.", statusCode: 403);

        var existing = await db.WorkspaceMembers.FirstOrDefaultAsync(m => m.WorkspaceId == invite.WorkspaceId && m.UserId == user.Id);
        if (existing is null)
        {
            db.WorkspaceMembers.Add(new WorkspaceMember { WorkspaceId = invite.WorkspaceId, UserId = user.Id, Role = invite.Role });
            activity.Add(invite.WorkspaceId, user.Id, "member.joined", "انضم إلى مساحة العمل");
        }
        invite.AcceptedAt = DateTime.UtcNow;
        await db.SaveChangesAsync();
        await events.ChangedAsync(invite.WorkspaceId, "members");

        var count = await db.WorkspaceMembers.CountAsync(m => m.WorkspaceId == invite.WorkspaceId);
        return new WorkspaceSummary(invite.WorkspaceId, invite.Workspace.Name, invite.Workspace.AccentColor,
            existing?.Role ?? invite.Role, count);
    }
}
