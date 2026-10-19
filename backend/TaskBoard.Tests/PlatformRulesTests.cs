using System.Net;
using TaskBoard.Api.Contracts;

namespace TaskBoard.Tests;

/// <summary>A fresh platform with sign-up by invitation and workspace creation for owners/admins.</summary>
public class StrictPlatformApp : TestApp
{
    protected override bool StrictPlatform => true;
}

public class PlatformRulesTests(StrictPlatformApp app) : IClassFixture<StrictPlatformApp>
{
    [Fact]
    public async Task Invitations_gate_sign_up_and_owners_and_admins_gate_workspaces()
    {
        // The very first account and workspace are allowed, so the platform can start.
        var founder = app.NewClient();
        var me = await founder.RegisterAsync();
        await founder.EnrollTwoFactorAsync();
        Assert.True((await founder.GetOk<MeResponse>("/api/auth/me")).CanCreateWorkspace);
        var ws = await founder.PostOk<WorkspaceDetail>("/api/workspaces", new { name = "Amanah" });

        // After that, nobody signs up without an invitation for their own email.
        var stranger = app.NewClient();
        User.Status(HttpStatusCode.Forbidden, await stranger.Post("/api/auth/register",
            new { email = "walk.in@example.com", password = "a long enough password", displayName = "Walk In" }));

        var invite = await founder.PostOk<InvitationDto>($"/api/workspaces/{ws.Id}/invitations", new { email = "invited@example.com", role = "Member" });
        User.Status(HttpStatusCode.Forbidden, await stranger.Post("/api/auth/register",
            new { email = "someone.else@example.com", password = "a long enough password", displayName = "Else", inviteToken = invite.Token }));

        var member = app.NewClient();
        await member.RegisterAsync("invited@example.com", invite.Token);
        await member.EnrollTwoFactorAsync();
        await member.PostOk<WorkspaceSummary>($"/api/invitations/{invite.Token}/accept", new { });

        // A member cannot start a workspace; promoted to admin, they can.
        Assert.False((await member.GetOk<MeResponse>("/api/auth/me")).CanCreateWorkspace);
        User.Status(HttpStatusCode.Forbidden, await member.Post("/api/workspaces", new { name = "Mine" }));
        User.Status(HttpStatusCode.NoContent, await founder.Patch($"/api/workspaces/{ws.Id}/members/{member.Id}", new { role = "Admin" }));
        Assert.True((await member.GetOk<MeResponse>("/api/auth/me")).CanCreateWorkspace);
        User.Status(HttpStatusCode.Created, await member.Post("/api/workspaces", new { name = "Admin made" }));

        // A used invitation cannot open the door for a second account.
        User.Status(HttpStatusCode.Forbidden, await app.NewClient().Post("/api/auth/register",
            new { email = "invited@example.com", password = "a long enough password", displayName = "Again", inviteToken = invite.Token }));
    }
}
