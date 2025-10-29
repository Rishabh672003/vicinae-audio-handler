import React, { useEffect, useState } from "react";
import { List, ActionPanel, Action, Icon, showToast, Toast } from "@vicinae/api";
import { execFile as execFileCb } from "node:child_process";
import { promisify } from "node:util";

const execFile = promisify(execFileCb);

interface Player {
  name: string;
  status: string;
  label: string;
  playing: boolean;
}

async function run(cmd: string, args: string[], opts?: { ignoreError?: boolean }): Promise<string> {
  try {
    const { stdout } = await execFile(cmd, args);
    return String(stdout).trim();
  } catch (e) {
    if (!opts?.ignoreError) throw e;
    return "";
  }
}

async function getPlayers(): Promise<Player[]> {
  const namesOut = await run("playerctl", ["--list-all"], { ignoreError: true });
  if (!namesOut) return [];
  const names = namesOut
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b));

  const statuses = await Promise.all(
    names.map(async (name) => {
      const status = await run("playerctl", ["status", "-p", name], { ignoreError: true });
      return status || "Unknown";
    })
  );

  return names.map((name, i) => {
    const status = statuses[i];
    const playing = status === "Playing";
    const displayName = name.split(".")[0];
    const label = playing ? `${displayName} (Playing)` : displayName;
    return { name, status, label, playing };
  });
}

async function playerCommand(command: string, playerName?: string) {
  const args = playerName ? [command, "-p", playerName] : [command];
  await run("playerctl", args, { ignoreError: false });
}

export default function Command() {
  const [players, setPlayers] = useState<Player[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [lastAction, setLastAction] = useState<string>("");

  async function refreshPlayers(silent = false) {
    try {
      if (!silent) setIsLoading(true);
      const list = await getPlayers();
      setPlayers(list);
    } catch {
      await showToast({
        style: Toast.Style.Failure,
        title: "Failed to get players",
        message: "Make sure playerctl is installed and media is playing",
      });
      setPlayers([]);
    } finally {
      setIsLoading(false);
    }
  }

  // Controls
  async function togglePlayer(playerName: string) {
    setLastAction(`play-pause for ${playerName}`);
    try {
      await playerCommand("play-pause", playerName);
      setTimeout(() => refreshPlayers(true), 400);
    } catch {
      await showToast({
        style: Toast.Style.Failure,
        title: `Failed to toggle ${playerName.split(".")[0]}`,
      });
    }
  }

  async function playPlayer(playerName: string) {
    setLastAction(`play for ${playerName}`);
    try {
      await playerCommand("play", playerName);
      setTimeout(() => refreshPlayers(true), 300);
    } catch {
      await showToast({
        style: Toast.Style.Failure,
        title: `Failed to play ${playerName.split(".")[0]}`,
      });
    }
  }

  async function pausePlayer(playerName: string) {
    setLastAction(`pause for ${playerName}`);
    try {
      await playerCommand("pause", playerName);
      setTimeout(() => refreshPlayers(true), 300);
    } catch {
      await showToast({
        style: Toast.Style.Failure,
        title: `Failed to pause ${playerName.split(".")[0]}`,
      });
    }
  }

  async function nextTrack() {
    const active = players.find((p) => p.playing);
    try {
      if (active) {
        setLastAction(`next for ${active.name}`);
        await playerCommand("next", active.name);
      } else {
        setLastAction("next (global)");
        await playerCommand("next");
      }
      setTimeout(() => refreshPlayers(true), 300);
    } catch {
      await showToast({ style: Toast.Style.Failure, title: "Failed to go to next track" });
    }
  }

  async function previousTrack() {
    const active = players.find((p) => p.playing);
    try {
      if (active) {
        setLastAction(`previous for ${active.name}`);
        await playerCommand("previous", active.name);
      } else {
        setLastAction("previous (global)");
        await playerCommand("previous");
      }
      setTimeout(() => refreshPlayers(true), 300);
    } catch {
      await showToast({ style: Toast.Style.Failure, title: "Failed to go to previous track" });
    }
  }

  async function pauseAllPlayers() {
    const toPause = players.filter((p) => p.playing);
    setLastAction(`pause all (${toPause.length})`);
    try {
      await Promise.all(toPause.map((p) => playerCommand("pause", p.name)));
      await showToast({ style: Toast.Style.Success, title: "Paused all players" });
    } catch {
      await showToast({ style: Toast.Style.Failure, title: "Failed to pause all players" });
    } finally {
      setTimeout(() => refreshPlayers(true), 300);
    }
  }

  async function pauseAllExcept(playerName: string) {
    const others = players.filter((p) => p.name !== playerName && p.playing);
    setLastAction(`pause all except ${playerName} (${others.length})`);
    try {
      await Promise.all(others.map((p) => playerCommand("pause", p.name)));
      await showToast({
        style: Toast.Style.Success,
        title: `Paused ${others.length} other player${others.length === 1 ? "" : "s"}`,
      });
    } catch {
      await showToast({ style: Toast.Style.Failure, title: "Failed to pause others" });
    } finally {
      setTimeout(() => refreshPlayers(true), 300);
    }
  }

  async function testPlayerctl() {
    await showToast({ style: Toast.Style.Animated, title: "Testing playerctl..." });
    try {
      const v = await run("playerctl", ["--version"], { ignoreError: false });
      await showToast({ style: Toast.Style.Success, title: `playerctl: ${v}` });
    } catch {
      await showToast({
        style: Toast.Style.Failure,
        title: "playerctl not found",
        message: "Install with: sudo apt install playerctl",
      });
    }
  }

  function getPlayerIcon(status: string) {
    switch (status) {
      case "Playing":
        return Icon.Play;
      case "Paused":
        return Icon.Pause;
      case "Stopped":
        return Icon.Stop;
      default:
        return Icon.SpeakerOn;
    }
  }

  function getStatusEmoji(status: string) {
    switch (status) {
      case "Playing":
        return "▶️";
      case "Paused":
        return "⏸️";
      case "Stopped":
        return "⏹️";
      default:
        return "❓";
    }
  }

  useEffect(() => {
    // initial load
    refreshPlayers();
  }, []);

  return (
    <List isLoading={isLoading} searchBarPlaceholder="Search media players...">
      {/* 1) Media Players at the top */}
      <List.Section title="Media Players">
        {players.map((player) => (
          <List.Item
            key={player.name}
            icon={getPlayerIcon(player.status)}
            title={player.label}
            accessories={[{ text: getStatusEmoji(player.status) }, { text: player.status }]}
            actions={
              <ActionPanel>
                <ActionPanel.Section title="Player Controls">
                  <Action title="Toggle Play/Pause" icon={Icon.Play} onAction={() => togglePlayer(player.name)} />
                  <Action title="Play" icon={Icon.Play} onAction={() => playPlayer(player.name)} />
                  <Action title="Pause" icon={Icon.Pause} onAction={() => pausePlayer(player.name)} />
                  <Action
                    title="Pause All Except This"
                    icon={Icon.SpeakerOff}
                    onAction={() => pauseAllExcept(player.name)}
                  />
                </ActionPanel.Section>

                <ActionPanel.Section title="Global Controls">
                  <Action title="Next Track" icon={Icon.Forward} onAction={nextTrack} />
                  <Action title="Previous Track" icon={Icon.Rewind} onAction={previousTrack} />
                  <Action title="Pause All Players" icon={Icon.SpeakerOff} onAction={pauseAllPlayers} />
                </ActionPanel.Section>

                <ActionPanel.Section>
                  <Action title="Refresh Players" icon={Icon.ArrowClockwise} onAction={() => refreshPlayers()} />
                  <Action title="Test playerctl" icon={Icon.Terminal} onAction={testPlayerctl} />
                </ActionPanel.Section>
              </ActionPanel>
            }
          />
        ))}

        {players.length === 0 && !isLoading && (
          <List.Item
            icon={Icon.SpeakerOff}
            title="No media players found"
            accessories={[{ text: "Start playing media to see players" }]}
            actions={
              <ActionPanel>
                <Action title="Refresh" icon={Icon.ArrowClockwise} onAction={() => refreshPlayers()} />
                <Action title="Test playerctl" icon={Icon.Terminal} onAction={testPlayerctl} />
              </ActionPanel>
            }
          />
        )}
      </List.Section>

      {/* 2) Global Options next */}
      <List.Section title="Global Controls">
        <List.Item
          title="Pause All Players"
          icon={Icon.SpeakerOff}
          actions={
            <ActionPanel>
              <Action title="Pause All Players" icon={Icon.SpeakerOff} onAction={pauseAllPlayers} />
              <Action title="Refresh Players" icon={Icon.ArrowClockwise} onAction={() => refreshPlayers()} />
            </ActionPanel>
          }
        />
        <List.Item
          title="Next Track"
          icon={Icon.Forward}
          actions={
            <ActionPanel>
              <Action title="Next Track" icon={Icon.Forward} onAction={nextTrack} />
              <Action title="Refresh Players" icon={Icon.ArrowClockwise} onAction={() => refreshPlayers()} />
            </ActionPanel>
          }
        />
        <List.Item
          title="Previous Track"
          icon={Icon.Rewind}
          actions={
            <ActionPanel>
              <Action title="Previous Track" icon={Icon.Rewind} onAction={previousTrack} />
              <Action title="Refresh Players" icon={Icon.ArrowClockwise} onAction={() => refreshPlayers()} />
            </ActionPanel>
          }
        />
      </List.Section>

      {/* 3) Debug at the bottom */}
      {lastAction && (
        <List.Section title="Debug">
          <List.Item icon={Icon.Info} title="Last Action" subtitle={lastAction} />
        </List.Section>
      )}
    </List>
  );
}
