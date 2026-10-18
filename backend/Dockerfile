# syntax=docker/dockerfile:1.7
FROM mcr.microsoft.com/dotnet/sdk:10.0 AS build
WORKDIR /src
COPY TaskBoard.Api/TaskBoard.Api.csproj TaskBoard.Api/
RUN dotnet restore TaskBoard.Api/TaskBoard.Api.csproj
COPY TaskBoard.Api/ TaskBoard.Api/
RUN dotnet publish TaskBoard.Api/TaskBoard.Api.csproj -c Release -o /out --no-restore /p:UseAppHost=false

FROM mcr.microsoft.com/dotnet/aspnet:10.0 AS runtime
WORKDIR /app
COPY --from=build /out .
ENV ASPNETCORE_URLS=http://+:8080 \
    ASPNETCORE_ENVIRONMENT=Production \
    DOTNET_gcServer=0
EXPOSE 8080
# The base image ships a non-root "app" user; never run the API as root.
USER $APP_UID
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD ["dotnet", "TaskBoard.Api.dll", "--healthcheck"]
ENTRYPOINT ["dotnet", "TaskBoard.Api.dll"]
