using System.Text;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using TaskBoard.Api.Contracts;
using TaskBoard.Api.Services;

namespace TaskBoard.Api.Controllers;

[ApiController]
[Authorize]
[Route("api/workspaces/{workspaceId:guid}")]
public class ReportsController(WorkspaceAccess access, Reports reports) : ControllerBase
{
    [HttpGet("dashboard")]
    public async Task<DashboardResponse> Dashboard(Guid workspaceId, [FromQuery] int tz = 0)
    {
        var role = await access.RequireAsync(workspaceId);
        return await reports.DashboardAsync(workspaceId, access.UserId, role, tz);
    }

    [HttpGet("analytics")]
    public async Task<AnalyticsResponse> Analytics(Guid workspaceId, [FromQuery] int range = 30, [FromQuery] int tz = 0)
    {
        var role = await access.RequireAsync(workspaceId);
        return await reports.AnalyticsAsync(workspaceId, access.UserId, role, range, tz);
    }

    [HttpGet("analytics/export")]
    public async Task<IActionResult> Export(Guid workspaceId, [FromQuery] int range = 30)
    {
        var role = await access.RequireAsync(workspaceId);
        var csv = await reports.CompletedCsvAsync(workspaceId, access.UserId, role, range);
        var bytes = Encoding.UTF8.GetPreamble().Concat(Encoding.UTF8.GetBytes(csv)).ToArray(); // BOM so Excel reads Arabic
        return File(bytes, "text/csv", $"completed-{DateTime.UtcNow:yyyy-MM-dd}.csv");
    }
}
