import { Plugin, TAbstractFile, TFile, WorkspaceLeaf } from "obsidian";
import { Vault3DScanner } from "./scanner";
import { DEFAULT_SETTINGS, Hub3DSettings } from "./types";
import { Hub3DView, VIEW_TYPE_3D_HUB } from "./view";

export default class Hub3DPlugin extends Plugin {
	public settings: Hub3DSettings = { ...DEFAULT_SETTINGS };
	public scanner!: Vault3DScanner;
	private refreshTimer: number | null = null;

	public async onload(): Promise<void> {
		await this.loadSettings();
		this.scanner = new Vault3DScanner(this.app);

		this.registerView(VIEW_TYPE_3D_HUB, (leaf) => new Hub3DView(leaf, this));

		this.addRibbonIcon("box", "Открыть 3D Spatial Hub", () => {
			void this.activateView();
		});

this.addCommand({
			id: "open-3d-spatial-hub",
			name: "Открыть холст 3D Spatial Hub",
			callback: () => {
				void this.activateView();
			}
		});

		this.addCommand({
			id: "open-active-note-schema",
			name: "Открыть схему текущей 3D-заметки",
			callback: () => {
				const activeFile = this.app.workspace.getActiveFile();
				if (!activeFile || activeFile.extension !== "md") return;
				void this.activateView().then(() => {
					const leaf = this.app.workspace.getLeavesOfType(VIEW_TYPE_3D_HUB)[0];
					if (leaf?.view instanceof Hub3DView) {
						leaf.view.openInspectorForFile(activeFile);
					}
				});
			}
		});

		this.registerEvent(
			this.app.metadataCache.on("changed", (file) => {
				if (this.scanner.isRelevantFile(file)) this.scheduleRefresh();
			})
		);

		this.registerEvent(
			this.app.vault.on("delete", (file: TAbstractFile) => {
				if (!(file instanceof TFile)) return;
				if (file.extension === "md") {
					const cleaned = this.cleanupNotePath(file.path);
					if (cleaned) void this.saveSettings();
					if (cleaned || this.scanner.isKnownPath(file.path)) this.scheduleRefresh();
				} else if (this.cleanupAssetPath(file.path)) {
					void this.saveSettings();
					this.scheduleRefresh();
				}
			})
		);

		this.registerEvent(
			this.app.vault.on("rename", (file: TAbstractFile, oldPath: string) => {
				if (!(file instanceof TFile)) return;
				if (file.extension === "md") {
					const remapped = this.remapNotePath(oldPath, file.path);
					if (remapped) void this.saveSettings();
					if (remapped || this.scanner.isKnownPath(oldPath) || this.scanner.isRelevantFile(file)) {
						this.scheduleRefresh();
					}
				} else if (this.remapAssetPath(oldPath, file.path)) {
					void this.saveSettings();
					this.scheduleRefresh();
				}
			})
		);
	}

	public onunload(): void {
		if (this.refreshTimer !== null) {
			window.clearTimeout(this.refreshTimer);
		}
	}

public async activateView(): Promise<void> {
		const { workspace } = this.app;
		let leaf: WorkspaceLeaf | null = workspace.getLeavesOfType(VIEW_TYPE_3D_HUB)[0] || null;

		if (!leaf) {
			leaf = workspace.getLeaf("tab");
			await leaf.setViewState({ type: VIEW_TYPE_3D_HUB, active: true });
		}
		workspace.revealLeaf(leaf);
	}

	public async openInspector(options: { file: TFile }): Promise<void> {
		await this.activateView();
		const leaf = this.app.workspace.getLeavesOfType(VIEW_TYPE_3D_HUB)[0];
		if (leaf?.view instanceof Hub3DView) {
			leaf.view.openInspectorForFile(options.file);
		}
	}

	public scheduleRefresh(): void {
		if (this.app.workspace.getLeavesOfType(VIEW_TYPE_3D_HUB).length === 0) return;
		if (this.refreshTimer !== null) {
			window.clearTimeout(this.refreshTimer);
		}
		this.refreshTimer = window.setTimeout(() => {
			this.refreshTimer = null;
			for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE_3D_HUB)) {
				if (leaf.view instanceof Hub3DView) {
					leaf.view.markDirtyOrRefresh();
				}
			}
		}, 120);
	}

	public async loadSettings(): Promise<void> {
		const loaded = await this.loadData();
		this.settings = Object.assign({}, DEFAULT_SETTINGS, loaded);
	}

	public remapNotePath(oldPath: string, newPath: string): boolean {
		if (!oldPath || !newPath || oldPath === newPath) return false;
		let changed = false;
		const oldSuffix = `::${oldPath}`;
		const newSuffix = `::${newPath}`;
		const remapId = (id: string) =>
			id.endsWith(oldSuffix) ? id.slice(0, -oldSuffix.length) + newSuffix : id;

		const existingStyle = this.settings.noteStyles[oldPath];
		if (existingStyle) {
			this.settings.noteStyles[newPath] = existingStyle;
			delete this.settings.noteStyles[oldPath];
			changed = true;
		}

		for (const key of Object.keys(this.settings.bubblePositions)) {
			if (key.endsWith(oldSuffix)) {
				const pos = this.settings.bubblePositions[key];
				if (pos) this.settings.bubblePositions[remapId(key)] = pos;
				delete this.settings.bubblePositions[key];
				changed = true;
			}
		}

		for (const link of this.settings.bubbleLinks) {
			const nextFrom = remapId(link.from);
			const nextTo = remapId(link.to);
			if (nextFrom !== link.from || nextTo !== link.to) {
				link.from = nextFrom;
				link.to = nextTo;
				changed = true;
			}
		}

		for (const key of Object.keys(this.settings.clusterNames)) {
			const parts = key.split("|");
			if (parts.some((p) => p.endsWith(oldSuffix))) {
				const nextKey = parts.map(remapId).sort().join("|");
				if (nextKey !== key) {
					const title = this.settings.clusterNames[key];
					if (title !== undefined) this.settings.clusterNames[nextKey] = title;
					delete this.settings.clusterNames[key];
					changed = true;
				}
			}
		}

		return changed;
	}

	public cleanupNotePath(path: string): boolean {
		if (!path) return false;
		let changed = false;
		const suffix = `::${path}`;

		if (this.settings.noteStyles[path]) {
			delete this.settings.noteStyles[path];
			changed = true;
		}

		for (const key of Object.keys(this.settings.bubblePositions)) {
			if (key.endsWith(suffix)) {
				delete this.settings.bubblePositions[key];
				changed = true;
			}
		}

		const prevLinksLen = this.settings.bubbleLinks.length;
		this.settings.bubbleLinks = this.settings.bubbleLinks.filter(
			(l) => !l.from.endsWith(suffix) && !l.to.endsWith(suffix)
		);
		if (this.settings.bubbleLinks.length !== prevLinksLen) changed = true;

		for (const key of Object.keys(this.settings.clusterNames)) {
			const parts = key.split("|");
			if (parts.some((p) => p.endsWith(suffix))) {
				const remaining = parts.filter((p) => !p.endsWith(suffix));
				const title = this.settings.clusterNames[key];
				delete this.settings.clusterNames[key];
				if (remaining.length >= 2 && title !== undefined) {
					const nextKey = remaining.sort().join("|");
					if (!this.settings.clusterNames[nextKey]) {
						this.settings.clusterNames[nextKey] = title;
					}
				}
				changed = true;
			}
		}

		return changed;
	}

	public remapAssetPath(oldPath: string, newPath: string): boolean {
		if (!oldPath || !newPath || oldPath === newPath) return false;
		let changed = false;
		for (const style of Object.values(this.settings.noteStyles)) {
			if (style.iconImage === oldPath) {
				style.iconImage = newPath;
				changed = true;
			}
		}
		return changed;
	}

	public cleanupAssetPath(path: string): boolean {
		if (!path) return false;
		let changed = false;
		for (const [notePath, style] of Object.entries(this.settings.noteStyles)) {
			if (style.iconImage === path) {
				delete style.iconImage;
				if (!style.icon) delete this.settings.noteStyles[notePath];
				changed = true;
			}
		}
		return changed;
	}

	public async saveSettings(): Promise<void> {
		await this.saveData(this.settings);
	}
}