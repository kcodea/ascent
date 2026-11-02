import { create } from 'zustand';

/**
 * Whether the Scene Builder PANEL is closed (R-SB-PANEL-CLOSE-01, owner report 2026-11-02). Closing the panel (its
 * header ✕) hides the panel only: the sandbox run keeps going, the board stays, a Duos teammate stays. The dev menu's
 * "Scene Builder" action opens it again (or starts a sandbox when none is running). A tiny store of its own, not the
 * game store, so the dev menu can read it without importing the panel, and so nothing here reaches a run or a save.
 * DEV-only: both readers are stripped from production.
 */
export const useSbPanel = create<{ closed: boolean }>(() => ({ closed: false }));

export const closeSceneBuilderPanel = (): void => useSbPanel.setState({ closed: true });
export const openSceneBuilderPanel = (): void => useSbPanel.setState({ closed: false });
