using Microsoft.AspNetCore.DataProtection.EntityFrameworkCore;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Identity.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Storage.ValueConversion;
using TaskBoard.Api.Domain;

namespace TaskBoard.Api.Data;

public class AppDbContext(DbContextOptions<AppDbContext> options)
    : IdentityDbContext<AppUser, IdentityRole<Guid>, Guid>(options), IDataProtectionKeyContext
{
    public DbSet<Workspace> Workspaces => Set<Workspace>();
    public DbSet<WorkspaceMember> WorkspaceMembers => Set<WorkspaceMember>();
    public DbSet<Invitation> Invitations => Set<Invitation>();
    public DbSet<Project> Projects => Set<Project>();
    public DbSet<BoardColumn> Columns => Set<BoardColumn>();
    public DbSet<TaskItem> Tasks => Set<TaskItem>();
    public DbSet<TaskAssignee> TaskAssignees => Set<TaskAssignee>();
    public DbSet<ChecklistItem> ChecklistItems => Set<ChecklistItem>();
    public DbSet<TaskComment> Comments => Set<TaskComment>();
    public DbSet<ActivityEvent> Activity => Set<ActivityEvent>();
    public DbSet<DataProtectionKey> DataProtectionKeys => Set<DataProtectionKey>();

    protected override void OnModelCreating(ModelBuilder b)
    {
        base.OnModelCreating(b);

        b.Entity<AppUser>().Property(u => u.DisplayName).HasMaxLength(80);
        // Key XML can pass 2000 characters, the NVARCHAR2 limit on a standard Oracle 19c.
        if (Database.ProviderName?.Contains("Oracle") == true)
            b.Entity<DataProtectionKey>().Property(k => k.Xml).HasColumnType("NCLOB");

        b.Entity<Workspace>(e =>
        {
            e.Property(w => w.Name).HasMaxLength(80);
            e.Property(w => w.AccentColor).HasMaxLength(9);
            e.HasMany(w => w.Projects).WithOne().HasForeignKey(p => p.WorkspaceId).OnDelete(DeleteBehavior.Cascade);
            e.HasMany(w => w.Columns).WithOne().HasForeignKey(c => c.WorkspaceId).OnDelete(DeleteBehavior.Cascade);
        });

        b.Entity<WorkspaceMember>(e =>
        {
            e.HasKey(m => new { m.WorkspaceId, m.UserId });
            e.HasOne(m => m.Workspace).WithMany(w => w.Members).HasForeignKey(m => m.WorkspaceId);
            e.HasOne(m => m.User).WithMany().HasForeignKey(m => m.UserId);
        });

        b.Entity<Invitation>(e =>
        {
            e.HasIndex(i => i.Token).IsUnique();
            e.Property(i => i.Email).HasMaxLength(256);
            e.Property(i => i.Token).HasMaxLength(64);
        });

        b.Entity<Project>().Property(p => p.Name).HasMaxLength(80);
        b.Entity<BoardColumn>().Property(c => c.Name).HasMaxLength(40);

        b.Entity<TaskItem>(e =>
        {
            e.Property(t => t.Title).HasMaxLength(200);
            // Oracle stores '' as NULL, so an empty description must be allowed to be NULL.
            // Reads go through Mapping.ToDto, which turns it back into "".
            e.Property(t => t.Description).HasMaxLength(10_000).IsRequired(false);
            e.Property(t => t.Tag).HasMaxLength(30);
            e.HasIndex(t => new { t.WorkspaceId, t.ColumnId, t.Position });
            e.HasOne(t => t.Column).WithMany().HasForeignKey(t => t.ColumnId).OnDelete(DeleteBehavior.Restrict);
            e.HasOne(t => t.Project).WithMany().HasForeignKey(t => t.ProjectId).OnDelete(DeleteBehavior.SetNull);
            e.HasOne<Workspace>().WithMany().HasForeignKey(t => t.WorkspaceId).OnDelete(DeleteBehavior.Cascade);
            e.HasMany(t => t.Assignees).WithOne().HasForeignKey(a => a.TaskId).OnDelete(DeleteBehavior.Cascade);
            e.HasMany(t => t.Checklist).WithOne().HasForeignKey(c => c.TaskId).OnDelete(DeleteBehavior.Cascade);
            e.HasMany(t => t.Comments).WithOne().HasForeignKey(c => c.TaskId).OnDelete(DeleteBehavior.Cascade);
        });

        b.Entity<TaskAssignee>(e =>
        {
            e.HasKey(a => new { a.TaskId, a.UserId });
            e.HasOne(a => a.User).WithMany().HasForeignKey(a => a.UserId);
        });

        b.Entity<ChecklistItem>().Property(c => c.Text).HasMaxLength(300);
        b.Entity<TaskComment>(e =>
        {
            e.Property(c => c.Body).HasMaxLength(4000);
            e.HasOne(c => c.Author).WithMany().HasForeignKey(c => c.AuthorId);
        });

        b.Entity<ActivityEvent>(e =>
        {
            e.HasIndex(a => new { a.WorkspaceId, a.CreatedAt });
            e.Property(a => a.Type).HasMaxLength(40);
            e.Property(a => a.Summary).HasMaxLength(300);
            e.HasOne(a => a.Actor).WithMany().HasForeignKey(a => a.ActorId);
            e.HasOne<Workspace>().WithMany().HasForeignKey(a => a.WorkspaceId).OnDelete(DeleteBehavior.Cascade);
        });

        // Every timestamp is stored and read back as UTC, whatever the provider hands back.
        var utc = new ValueConverter<DateTime, DateTime>(
            v => v.Kind == DateTimeKind.Utc ? v : v.ToUniversalTime(),
            v => DateTime.SpecifyKind(v, DateTimeKind.Utc));
        var utcNullable = new ValueConverter<DateTime?, DateTime?>(
            v => v == null ? v : v.Value.Kind == DateTimeKind.Utc ? v : v.Value.ToUniversalTime(),
            v => v == null ? v : DateTime.SpecifyKind(v.Value, DateTimeKind.Utc));
        // The Oracle provider has no DateOnly mapping; store it as a plain DATE (no time, no zone).
        var date = new ValueConverter<DateOnly, DateTime>(d => d.ToDateTime(TimeOnly.MinValue), d => DateOnly.FromDateTime(d));
        var dateNullable = new ValueConverter<DateOnly?, DateTime?>(
            d => d == null ? null : d.Value.ToDateTime(TimeOnly.MinValue),
            d => d == null ? null : DateOnly.FromDateTime(d.Value));
        var oracle = Database.ProviderName?.Contains("Oracle") == true;

        foreach (var entity in b.Model.GetEntityTypes())
        foreach (var prop in entity.GetProperties())
        {
            if (prop.ClrType == typeof(DateTime)) prop.SetValueConverter(utc);
            else if (prop.ClrType == typeof(DateTime?)) prop.SetValueConverter(utcNullable);
            else if (prop.ClrType == typeof(DateOnly) || prop.ClrType == typeof(DateOnly?))
            {
                prop.SetValueConverter(prop.ClrType == typeof(DateOnly) ? date : dateNullable);
                if (oracle) prop.SetColumnType("DATE");
            }
        }
    }
}
