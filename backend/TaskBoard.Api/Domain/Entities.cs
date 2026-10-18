using Microsoft.AspNetCore.Identity;

namespace TaskBoard.Api.Domain;

public class AppUser : IdentityUser<Guid>
{
    public string DisplayName { get; set; } = "";
    public string AvatarColor { get; set; } = "#175cd3";
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}

public enum WorkspaceRole
{
    Viewer = 0,
    Member = 1,
    Admin = 2,
    Owner = 3,
}

public class Workspace
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public string Name { get; set; } = "";
    public string AccentColor { get; set; } = "#1b8354";
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;

    public List<WorkspaceMember> Members { get; set; } = [];
    public List<Project> Projects { get; set; } = [];
    public List<BoardColumn> Columns { get; set; } = [];
}

public class WorkspaceMember
{
    public Guid WorkspaceId { get; set; }
    public Workspace Workspace { get; set; } = null!;
    public Guid UserId { get; set; }
    public AppUser User { get; set; } = null!;
    public WorkspaceRole Role { get; set; }
    public DateTime JoinedAt { get; set; } = DateTime.UtcNow;
}

public class Invitation
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid WorkspaceId { get; set; }
    public Workspace Workspace { get; set; } = null!;
    public string Email { get; set; } = "";
    public WorkspaceRole Role { get; set; }
    public string Token { get; set; } = "";
    public Guid InvitedById { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime ExpiresAt { get; set; }
    public DateTime? AcceptedAt { get; set; }
}

public class Project
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid WorkspaceId { get; set; }
    public string Name { get; set; } = "";
    public string Color { get; set; } = "#175cd3";
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}

/// <summary>What a column means for reporting; the board itself treats all columns the same.</summary>
public enum ColumnKind
{
    Todo = 0,
    InProgress = 1,
    Review = 2,
    Done = 3,
}

public class BoardColumn
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid WorkspaceId { get; set; }
    public string Name { get; set; } = "";
    public ColumnKind Kind { get; set; }
    public int Position { get; set; }
}

public enum TaskPriority
{
    Low = 0,
    Medium = 1,
    High = 2,
    Urgent = 3,
}

public class TaskItem
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid WorkspaceId { get; set; }
    public Guid ColumnId { get; set; }
    public BoardColumn Column { get; set; } = null!;
    public Guid? ProjectId { get; set; }
    public Project? Project { get; set; }
    public string Title { get; set; } = "";
    public string Description { get; set; } = "";
    public string? Tag { get; set; }
    public TaskPriority Priority { get; set; } = TaskPriority.Medium;
    public DateOnly? DueDate { get; set; }
    public int Position { get; set; }
    public int TrackedMinutes { get; set; }
    public Guid CreatedById { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;
    public DateTime? StartedAt { get; set; }
    public DateTime? CompletedAt { get; set; }

    public List<TaskAssignee> Assignees { get; set; } = [];
    public List<ChecklistItem> Checklist { get; set; } = [];
    public List<TaskComment> Comments { get; set; } = [];
}

public class TaskAssignee
{
    public Guid TaskId { get; set; }
    public Guid UserId { get; set; }
    public AppUser User { get; set; } = null!;
}

public class ChecklistItem
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid TaskId { get; set; }
    public string Text { get; set; } = "";
    public bool Done { get; set; }
    public int Position { get; set; }
}

public class TaskComment
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid TaskId { get; set; }
    public Guid AuthorId { get; set; }
    public AppUser Author { get; set; } = null!;
    public string Body { get; set; } = "";
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}

public class ActivityEvent
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid WorkspaceId { get; set; }
    public Guid? TaskId { get; set; }
    public Guid ActorId { get; set; }
    public AppUser Actor { get; set; } = null!;
    /// <summary>task.created, task.moved, task.completed, comment.added, member.joined, ...</summary>
    public string Type { get; set; } = "";
    public string Summary { get; set; } = "";
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}
