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
				if (file.extension === "md") this.scheduleRefresh();
			})
		);

		this.registerEvent(
			this.app.vault.on("delete", (file: TAbstractFile) => {
				if (file instanceof TFile && file.extension === "md") this.scheduleRefresh();
			})
		);

		this.registerEvent(
			this.app.vault.on("rename", (file: TAbstractFile) => {
				if (file instanceof TFile && file.extension === "md") this.scheduleRefresh();
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

	public scheduleRefresh(): void {
		if (this.refreshTimer !== null) {
			window.clearTimeout(this.refreshTimer);
		}
		this.refreshTimer = window.setTimeout(() => {
			this.refreshTimer = null;
			for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE_3D_HUB)) {
				if (leaf.view instanceof Hub3DView) {
					leaf.view.refresh();
				}
			}
		}, 120);
	}

	public async loadSettings(): Promise<void> {
		const loaded = await this.loadData();
		this.settings = Object.assign({}, DEFAULT_SETTINGS, loaded);
	}

	public async saveSettings(): Promise<void> {
		await this.saveData(this.settings);
	}
}