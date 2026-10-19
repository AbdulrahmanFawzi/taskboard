using System.ComponentModel.DataAnnotations;
using TaskBoard.Api.Domain;

namespace TaskBoard.Api.Contracts;

// ---- Auth ----
public record RegisterRequest(
    [Required, EmailAddress, MaxLength(256)] string Email,
    [Required, MinLength(10), MaxLength(128)] string Password,
    [Required, MinLength(2), MaxLength(80)] string DisplayName);

public record LoginRequest([Required] string Email, [Required] string Password, bool RememberMe = false);
public record TwoFactorLoginRequest([Required] string Code, bool RememberMachine = false);
public record RecoveryLoginRequest([Required] string RecoveryCode);
public record CodeRequest([Required] string Code);

public record LoginResponse(bool RequiresTwoFactor, MeResponse? User);
public record TwoFactorSetupResponse(string SharedKey, string AuthenticatorUri);
public record RecoveryCodesResponse(IReadOnlyList<string> RecoveryCodes);

public record MeResponse(
    Guid Id, string Email, string DisplayName, string AvatarColor,
    bool TwoFactorEnabled, bool TwoFactorRequired, bool SessionVerified, int RecoveryCodesLeft);

public record UserSummary(Guid Id, string DisplayName, string Email, string AvatarColor);

// ---- Workspaces ----
public record CreateWorkspaceRequest([Required, MinLength(2), MaxLength(80)] string Name, bool WithSampleData = false);
public record UpdateWorkspaceRequest([MinLength(2), MaxLength(80)] string? Name, [RegularExpression("^#[0-9a-fA-F]{6}$")] string? AccentColor);

public record WorkspaceSummary(Guid Id, string Name, string AccentColor, WorkspaceRole Role, int MemberCount);
public record WorkspaceDetail(
    Guid Id, string Name, string AccentColor, WorkspaceRole MyRole,
    IReadOnlyList<ColumnDto> Columns, IReadOnlyList<ProjectDto> Projects, IReadOnlyList<MemberDto> Members);

public record ColumnDto(Guid Id, string Name, ColumnKind Kind, int Position);
public record ProjectDto(Guid Id, string Name, string Color);
public record MemberDto(Guid UserId, string DisplayName, string Email, string AvatarColor, WorkspaceRole Role, DateTime JoinedAt);

public record CreateColumnRequest([Required, MaxLength(40)] string Name, ColumnKind Kind = ColumnKind.Todo);
public record UpdateColumnRequest([MaxLength(40)] string? Name, ColumnKind? Kind, int? Position);

public record CreateProjectRequest([Required, MaxLength(80)] string Name, [RegularExpression("^#[0-9a-fA-F]{6}$")] string? Color);
public record UpdateProjectRequest([MaxLength(80)] string? Name, [RegularExpression("^#[0-9a-fA-F]{6}$")] string? Color);

public record UpdateMemberRequest(WorkspaceRole Role);
public record CreateInvitationRequest([Required, EmailAddress] string Email, WorkspaceRole Role = WorkspaceRole.Member);
public record InvitationDto(Guid Id, string Email, WorkspaceRole Role, string Token, DateTime ExpiresAt, DateTime CreatedAt);
public record InvitationPreview(string WorkspaceName, string Email, WorkspaceRole Role, bool Expired, bool Accepted);

// ---- Tasks ----
public record TaskDto(
    Guid Id, Guid ColumnId, Guid? ProjectId, string Title, string Description, string? Tag,
    TaskPriority Priority, DateOnly? DueDate, int Position, int TrackedMinutes,
    IReadOnlyList<Guid> AssigneeIds, int ChecklistTotal, int ChecklistDone, int CommentCount,
    DateTime CreatedAt, DateTime UpdatedAt, DateTime? CompletedAt);

public record TaskDetailDto(TaskDto Task, IReadOnlyList<ChecklistItemDto> Checklist, IReadOnlyList<CommentDto> Comments);
public record ChecklistItemDto(Guid Id, string Text, bool Done, int Position);
public record CommentDto(Guid Id, Guid AuthorId, string AuthorName, string AuthorColor, string Body, DateTime CreatedAt);

public record CreateTaskRequest(
    [Required, MaxLength(200)] string Title,
    Guid? ColumnId,
    Guid? ProjectId,
    [MaxLength(10_000)] string? Description,
    [MaxLength(30)] string? Tag,
    TaskPriority Priority = TaskPriority.Medium,
    DateOnly? DueDate = null,
    IReadOnlyList<Guid>? AssigneeIds = null);

/// <summary>Only the fields that are sent are changed. ClearDueDate/ClearProject unset nullable fields.</summary>
public record UpdateTaskRequest(
    [MaxLength(200)] string? Title,
    [MaxLength(10_000)] string? Description,
    [MaxLength(30)] string? Tag,
    TaskPriority? Priority,
    DateOnly? DueDate,
    bool ClearDueDate,
    Guid? ProjectId,
    bool ClearProject,
    [Range(0, 100_000)] int? TrackedMinutes,
    IReadOnlyList<Guid>? AssigneeIds);

public record MoveTaskRequest(Guid ColumnId, [Range(0, int.MaxValue)] int Index);
public record CreateChecklistItemRequest([Required, MaxLength(300)] string Text);
public record UpdateChecklistItemRequest([MaxLength(300)] string? Text, bool? Done);
public record CreateCommentRequest([Required, MaxLength(4000)] string Body);

// ---- Dashboard & analytics ----
public record DashboardResponse(
    int TotalProjects, int ActiveTasks, int CompletedThisWeek, int WeekendThisWeek, int Overdue, int DueToday,
    IReadOnlyList<DayCount> ThisWeek, int LastWeekTotal,
    IReadOnlyList<ProjectProgress> Projects,
    IReadOnlyList<TaskDto> MyTasks,
    IReadOnlyList<ActivityDto> RecentActivity);

public record DayCount(DateOnly Date, int Count);
public record ProjectProgress(Guid Id, string Name, string Color, int Total, int Done);
public record ActivityDto(Guid Id, string Type, string Summary, Guid ActorId, string ActorName, string ActorColor, Guid? TaskId, DateTime CreatedAt);

public record AnalyticsResponse(
    int RangeDays,
    Metric TasksCompleted, Metric HoursTracked, Metric OnTimeRate, Metric AvgCycleDays,
    IReadOnlyList<ThroughputPoint> Throughput,
    IReadOnlyList<ProjectTime> TimeByProject,
    IReadOnlyList<DayCount> Heatmap,
    IReadOnlyList<Contributor> TopContributors,
    IReadOnlyList<StatusCount> ByStatus,
    IReadOnlyList<PriorityCount> ByPriority);

/// <summary>Value for the current range, the previous range of the same length, and a spark series.</summary>
public record Metric(double Value, double Previous, IReadOnlyList<double> Spark);
public record ThroughputPoint(DateOnly Date, int Current, int Previous);
public record ProjectTime(Guid? Id, string Name, string Color, double Hours);
public record Contributor(Guid UserId, string DisplayName, string AvatarColor, int Completed, double Hours);
public record StatusCount(Guid ColumnId, string Name, ColumnKind Kind, int Count);
public record PriorityCount(TaskPriority Priority, int Count);
