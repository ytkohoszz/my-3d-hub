import { FuzzySuggestModal, ItemView, Modal, Notice, TFile, TFolder, WorkspaceLeaf, normalizePath, setIcon } from "obsidian";

interface FocusTrackerApi {
	openFocusModal?: (opts?: { initialProject?: string }) => void;
}
import { BubbleCanvasEngine, BubbleNode, DropTargetInfo, NavLevel } from "./canvas";
import { extractImagesFromNote } from "./inspector/sceneStore";
import { NoteSchemaOverlay } from "./inspector/canvasOverlay";
import type Hub3DPlugin from "./main";
import { AREA_NAME, Note3D, PRESET_PROGRAMS, PRESET_TOPICS, mapTopic, topicParts } from "./types";

const ICON_IMAGE_EXTS = new Set(["png", "jpg", "jpeg", "webp", "svg", "gif"]);
const NOTE_STYLE_COLORS = ["#4aab80", "#e5a158", "#599ed6", "#9c83e8", "#d85b57", "#69b5aa", "#d4c05a", "#cbd5e1"];
const NOTE_STYLE_ICONS = ["🌲", "🌿", "📷", "💡", "🧊", "🌊", "🔥", "⚙️", "🎨", "✨"];

class IconImagePickerModal extends FuzzySuggestModal<TFile> {
	private onChoose: (file: TFile) => void;

	constructor(app: ItemView["app"], onChoose: (file: TFile) => void) {
		super(app);
		this.onChoose = onChoose;
		this.setPlaceholder("Выбери картинку-иконку из хранилища…");
	}

	public getItems(): TFile[] {
		return this.app.vault.getFiles().filter((f) => ICON_IMAGE_EXTS.has(f.extension.toLowerCase()));
	}

	public getItemText(item: TFile): string {
		return item.path;
	}

	public onChooseItem(item: TFile): void {
		this.onChoose(item);
	}
}

class ConfirmDeleteModal extends Modal {
	private message: string;
	private onConfirm: () => Promise<void>;

	constructor(app: ItemView["app"], message: string, onConfirm: () => Promise<void>) {
		super(app);
		this.message = message;
		this.onConfirm = onConfirm;
	}

	public onOpen(): void {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.createEl("h3", { text: "Подтвердите удаление" });
		contentEl.createEl("p", { text: this.message });

		const actions = contentEl.createDiv({ cls: "hub3d-modal-actions" });
		actions.style.display = "flex";
		actions.style.justifyContent = "flex-end";
		actions.style.gap = "8px";
		actions.style.marginTop = "14px";

		const cancelBtn = actions.createEl("button", { text: "Отмена" });
		cancelBtn.addEventListener("click", () => this.close());

		const delBtn = actions.createEl("button", { text: "Удалить", cls: "mod-warning" });
		delBtn.addEventListener("click", () => {
			delBtn.disabled = true;
			void this.onConfirm().finally(() => this.close());
		});
	}
}

type ActivePopoverMode = "none" | "topic" | "folder" | "note";

class ClusterRenameModal extends Modal {
	private currentTitle: string;
	private onSubmit: (nextTitle: string) => void;

	constructor(app: ItemView["app"], currentTitle: string, onSubmit: (nextTitle: string) => void) {
		super(app);
		this.currentTitle = currentTitle;
		this.onSubmit = onSubmit;
	}

	public onOpen(): void {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.createEl("h3", { text: "Название блока пузырей" });

		const input = contentEl.createEl("input", {
			type: "text",
			value: this.currentTitle,
			cls: "hub3d-modal-input"
		});
		input.style.width = "100%";
		input.style.marginBottom = "12px";

		const actions = contentEl.createDiv({ cls: "hub3d-modal-actions" });
		const saveBtn = actions.createEl("button", { text: "Сохранить", cls: "mod-cta" });
		saveBtn.addEventListener("click", () => {
			const val = input.value.trim();
			if (val) this.onSubmit(val);
			this.close();
		});

		input.addEventListener("keydown", (e) => {
			if (e.key === "Enter") {
				e.preventDefault();
				saveBtn.click();
			}
		});

		window.setTimeout(() => {
			input.focus();
			input.select();
		}, 20);
	}
}

export const VIEW_TYPE_3D_HUB = "my-3d-hub-view";

export class Hub3DView extends ItemView {
	private plugin: Hub3DPlugin;
	private notes: Note3D[] = [];
	private engine: BubbleCanvasEngine | null = null;

private topIslandEl: HTMLElement | null = null;
	private bottomDockEl: HTMLElement | null = null;
	private trashZoneEl: HTMLElement | null = null;
	private outsideZoneEl: HTMLElement | null = null;
	private popoverEl: HTMLElement | null = null;
private popoverMode: ActivePopoverMode = "none";
	private level: NavLevel = { program: null, topicPath: "" };
	private inspectorOverlay: NoteSchemaOverlay | null = null;
	private stylePopoverEl: HTMLElement | null = null;
	private styleOutsideHandler?: (e: PointerEvent) => void;

	constructor(leaf: WorkspaceLeaf, plugin: Hub3DPlugin) {
		super(leaf);
		this.plugin = plugin;
	}

	public getViewType(): string {
		return VIEW_TYPE_3D_HUB;
	}

	public getDisplayText(): string {
		return "3D Spatial Hub";
	}

	public getIcon(): string {
		return "box";
	}

	public async onOpen(): Promise<void> {
		const container = this.contentEl;
		container.empty();
		container.addClass("hub3d-root");

this.topIslandEl = container.createDiv({ cls: "hub3d-top-island" });
		this.trashZoneEl = container.createDiv({ cls: "hub3d-trash-zone", text: "🗑" });
		this.trashZoneEl.title = "Перетащи сюда тему, папку или заметку для удаления";
		this.outsideZoneEl = container.createDiv({ cls: "hub3d-outside-zone", text: "🌌 Вне тем" });
		this.outsideZoneEl.title = "Перетащи сюда заметку, чтобы убрать её из всех тем и папок";
		this.popoverEl = container.createDiv({ cls: "hub3d-dock-popover is-hidden" });
		this.bottomDockEl = container.createDiv({ cls: "hub3d-bottom-dock" });

		const canvasHost = container.createDiv({ cls: "hub3d-canvas-host" });
		this.engine = new BubbleCanvasEngine(canvasHost, {
			onNavigate: (next) => {
				if (next.program !== null) {
					this.level = { program: next.program, topicPath: "" };
				} else if (next.topicPath) {
					this.level = { program: this.level.program, topicPath: next.topicPath };
				}
				this.engine?.resetCamera();
				this.renderAll();
			},
			onOpenNote: (note, newTab) => {
				void this.app.workspace.openLinkText(note.path, "", newTab);
			},
			onInspectNote: (note) => {
				this.openNodeInspector(note);
			},
onSavePosition: (id, x, y) => {
				this.plugin.settings.bubblePositions[id] = { x, y };
				void this.plugin.saveSettings();
			},
			onToggleLink: (fromId, toId) => {
				const links = this.plugin.settings.bubbleLinks;
				const idx = links.findIndex(
					(l) => (l.from === fromId && l.to === toId) || (l.from === toId && l.to === fromId)
				);
				if (idx !== -1) {
					links.splice(idx, 1);
					new Notice("Связь между пузырями удалена");
				} else {
					links.push({ from: fromId, to: toId });
					new Notice("Пузыри сцеплены в блок");
				}
				void this.plugin.saveSettings();
				this.renderAll();
			},
onRenameCluster: (clusterKey, currentTitle) => {
				new ClusterRenameModal(this.app, currentTitle, (nextTitle) => {
					this.plugin.settings.clusterNames[clusterKey] = nextTitle;
					void this.plugin.saveSettings();
					this.renderAll();
				}).open();
			},
onDragStateChange: (draggingNode, overTrash, dropTarget: DropTargetInfo | null) => {
				if (this.trashZoneEl) {
					this.trashZoneEl.toggleClass("is-armed", draggingNode !== null);
					this.trashZoneEl.toggleClass("is-over", overTrash);
				}
				const isDraggingNote = draggingNode?.kind === "note";
				if (this.outsideZoneEl) {
					this.outsideZoneEl.toggleClass("is-visible", isDraggingNote);
					this.outsideZoneEl.toggleClass("is-over", dropTarget?.kind === "outside");
				}
				if (this.topIslandEl) {
					this.topIslandEl.querySelectorAll<HTMLElement>("[data-drop-topic]").forEach((el) => {
						const isMatch =
							dropTarget?.kind === "crumb" && (el.dataset.dropTopic ?? "") === dropTarget.topicPath;
						el.toggleClass("is-drop-hover", isMatch);
					});
				}
			},
			onDropToTrash: (node) => {
				this.handleDeleteRequest(node);
			},
onMoveNoteToTopic: (note, targetTopicPath) => {
				void this.moveNoteToTopic(note, targetTopicPath);
			},
			onStyleNote: (note, clientX, clientY) => {
				this.openNoteStylePopover(note, clientX, clientY);
			}
		});
this.engine.setDropZoneElements(this.trashZoneEl, this.outsideZoneEl, this.topIslandEl);
		this.engine.setResourcePathResolver((path) => this.app.vault.adapter.getResourcePath(path));

this.registerDomEvent(window, "keydown", (e: KeyboardEvent) => {
			if (!this.containerEl.isShown()) return;
			if (this.inspectorOverlay) {
				if (e.key === "Escape") {
					e.preventDefault();
					this.inspectorOverlay.close();
				}
				return;
			}
if (e.key === "Escape" && this.stylePopoverEl) {
				e.preventDefault();
				this.closeNoteStylePopover();
				return;
			}
			if (e.key === "Escape" && this.popoverMode !== "none") {
				e.preventDefault();
				this.closePopover();
				return;
			}
			if (["INPUT", "TEXTAREA", "SELECT"].includes(document.activeElement?.tagName || "")) return;
			if (e.key === "Escape" || e.key === "Backspace") {
				this.navigateUp();
			}
		});

		this.refresh();
	}

public async onClose(): Promise<void> {
		this.closeNoteStylePopover();
		this.inspectorOverlay?.destroy();
		this.inspectorOverlay = null;
		this.engine?.destroy();
		this.engine = null;
		this.contentEl.empty();
	}

	public refresh(): void {
		this.notes = this.plugin.scanner.scan();
		this.renderAll();
	}

	public navigateUp(): void {
		if (this.level.topicPath) {
			const parts = topicParts(this.level.topicPath);
			parts.pop();
			this.level = { program: this.level.program, topicPath: parts.join("/") };
			this.engine?.resetCamera();
			this.renderAll();
		} else if (this.level.program !== null) {
			this.level = { program: null, topicPath: "" };
			this.engine?.resetCamera();
			this.renderAll();
		}
	}

private renderAll(): void {
		this.renderTopIsland();
		this.renderBottomDock();
this.engine?.setData(
			this.notes,
			this.plugin.settings.virtualTopics,
			this.level,
			this.plugin.settings.bubblePositions,
			this.plugin.settings.bubbleLinks,
			this.plugin.settings.clusterNames,
			this.plugin.settings.noteStyles || {}
		);
	}

	private closePopover(): void {
		this.popoverMode = "none";
		if (this.popoverEl) {
			this.popoverEl.empty();
			this.popoverEl.addClass("is-hidden");
		}
		this.renderBottomDock();
	}

	private togglePopover(mode: ActivePopoverMode): void {
		if (this.popoverMode === mode) {
			this.closePopover();
			return;
		}
		this.popoverMode = mode;
		this.renderBottomDock();
		this.renderPopover();
	}

	private renderBottomDock(): void {
		if (!this.bottomDockEl) return;
		this.bottomDockEl.empty();

		const topicBtn = this.bottomDockEl.createEl("button", {
			cls: "hub3d-dock-btn" + (this.popoverMode === "topic" ? " is-active" : ""),
			text: "+ Тема"
		});
		topicBtn.title = "Создать новую тему в 1 клик";
		topicBtn.addEventListener("click", () => this.togglePopover("topic"));

		const folderBtn = this.bottomDockEl.createEl("button", {
			cls: "hub3d-dock-btn" + (this.popoverMode === "folder" ? " is-active" : ""),
			text: "+ Папка"
		});
		folderBtn.title = "Создать папку внутри темы";
		folderBtn.addEventListener("click", () => this.togglePopover("folder"));

		const noteBtn = this.bottomDockEl.createEl("button", {
			cls: "hub3d-dock-btn is-primary" + (this.popoverMode === "note" ? " is-active" : ""),
			text: "+ Заметка"
		});
		noteBtn.title = "Создать 3D-заметку в текущем разделе";
		noteBtn.addEventListener("click", () => this.togglePopover("note"));
	}

	private getKnownPrograms(): string[] {
		const set = new Set<string>(PRESET_PROGRAMS);
		for (const n of this.notes) {
			for (const p of n.programs) set.add(p);
		}
		for (const vt of this.plugin.settings.virtualTopics) {
			if (vt.program) set.add(vt.program);
		}
		return Array.from(set).sort((a, b) => a.localeCompare(b, "ru"));
	}

	private getKnownTopicsForProgram(prog: string): string[] {
		const set = new Set<string>(PRESET_TOPICS);
		for (const n of this.notes) {
			if (!prog || prog === "__none__" || n.programs.includes(prog)) {
				for (const t of n.topics) set.add(t);
			}
		}
		for (const vt of this.plugin.settings.virtualTopics) {
			if (!prog || vt.program === prog || vt.program === "") {
				const root = topicParts(vt.topicPath)[0];
				if (root) set.add(root);
			}
		}
		return Array.from(set).sort((a, b) => a.localeCompare(b, "ru"));
	}

	private renderPopover(): void {
		if (!this.popoverEl) return;
		this.popoverEl.empty();

		if (this.popoverMode === "none") {
			this.popoverEl.addClass("is-hidden");
			return;
		}
		this.popoverEl.removeClass("is-hidden");

		const currentProg = this.level.program && this.level.program !== "__none__" ? this.level.program : "";

		if (this.popoverMode === "topic") {
			this.popoverEl.createDiv({ cls: "hub3d-pop-header", text: "Новая тема" });

			let selectedProg = currentProg || "Blender";
			if (!currentProg) {
				const progRow = this.popoverEl.createDiv({ cls: "hub3d-pop-chips" });
				for (const p of this.getKnownPrograms()) {
					const chip = progRow.createEl("button", {
						cls: "hub3d-pop-chip" + (p === selectedProg ? " is-selected" : ""),
						text: p
					});
					chip.addEventListener("click", () => {
						selectedProg = p;
						progRow.querySelectorAll(".hub3d-pop-chip").forEach((el) => el.removeClass("is-selected"));
						chip.addClass("is-selected");
					});
				}
			}

			const input = this.popoverEl.createEl("input", {
				type: "text",
				cls: "hub3d-pop-input",
				placeholder: "Название темы (например: Симуляции)..."
			});

			// Быстрые пресеты тем
			const presetsRow = this.popoverEl.createDiv({ cls: "hub3d-pop-chips" });
			for (const preset of PRESET_TOPICS.slice(0, 6)) {
				const chip = presetsRow.createEl("button", { cls: "hub3d-pop-chip", text: preset });
				chip.addEventListener("click", () => {
					input.value = preset;
					submitTopic();
				});
			}

			const submitTopic = () => {
				const rawName = topicParts(input.value)[0];
				if (!rawName) {
					new Notice("Введи название темы");
					return;
				}
				const targetProg = currentProg || selectedProg;
				const exists = this.plugin.settings.virtualTopics.some(
					(vt) => vt.program === targetProg && vt.topicPath === rawName
				);
				if (!exists) {
					this.plugin.settings.virtualTopics.push({ program: targetProg, topicPath: rawName });
					void this.plugin.saveSettings();
				}
				if (!this.level.program) {
					this.level = { program: targetProg, topicPath: "" };
				}
				this.closePopover();
				this.renderAll();
				new Notice(`Тема «${rawName}» создана в ${targetProg}`);
			};

			const actions = this.popoverEl.createDiv({ cls: "hub3d-pop-actions" });
			const okBtn = actions.createEl("button", { cls: "hub3d-dock-btn is-primary", text: "Создать" });
			okBtn.addEventListener("click", submitTopic);
			actions.createEl("button", { cls: "hub3d-dock-btn", text: "Отмена" }).addEventListener("click", () =>
				this.closePopover()
			);

			input.addEventListener("keydown", (e) => {
				if (e.key === "Enter") {
					e.preventDefault();
					submitTopic();
				}
			});
			window.setTimeout(() => input.focus(), 15);
			return;
		}

		if (this.popoverMode === "folder") {
			this.popoverEl.createDiv({ cls: "hub3d-pop-header", text: "Новая папка" });

			const targetProg = currentProg || "Blender";
			let baseTopic = this.level.topicPath;

			if (!baseTopic) {
				const topics = this.getKnownTopicsForProgram(targetProg);
				baseTopic = topics[0] || "Моделирование";
				const topicRow = this.popoverEl.createDiv({ cls: "hub3d-pop-chips" });
				for (const t of topics.slice(0, 7)) {
					const chip = topicRow.createEl("button", {
						cls: "hub3d-pop-chip" + (t === baseTopic ? " is-selected" : ""),
						text: t
					});
					chip.addEventListener("click", () => {
						baseTopic = t;
						topicRow.querySelectorAll(".hub3d-pop-chip").forEach((el) => el.removeClass("is-selected"));
						chip.addClass("is-selected");
					});
				}
			} else {
				this.popoverEl.createDiv({
					cls: "hub3d-pop-sub",
					text: `Внутри: ${targetProg} / ${baseTopic}`
				});
			}

			const input = this.popoverEl.createEl("input", {
				type: "text",
				cls: "hub3d-pop-input",
				placeholder: "Название папки (например: Bevel или Фаски)..."
			});

			const submitFolder = () => {
				const subParts = topicParts(input.value);
				if (!subParts.length) {
					new Notice("Введи название папки");
					return;
				}
				const fullTopicPath = `${baseTopic}/${subParts.join("/")}`;
				const exists = this.plugin.settings.virtualTopics.some(
					(vt) => vt.program === targetProg && vt.topicPath === fullTopicPath
				);
				if (!exists) {
					this.plugin.settings.virtualTopics.push({ program: targetProg, topicPath: fullTopicPath });
					void this.plugin.saveSettings();
				}
				this.level = { program: targetProg, topicPath: baseTopic };
				this.closePopover();
				this.renderAll();
				new Notice(`Папка «${subParts.join("/")}» создана`);
			};

			const actions = this.popoverEl.createDiv({ cls: "hub3d-pop-actions" });
			actions.createEl("button", { cls: "hub3d-dock-btn is-primary", text: "Создать папку" }).addEventListener(
				"click",
				submitFolder
			);
			actions.createEl("button", { cls: "hub3d-dock-btn", text: "Отмена" }).addEventListener("click", () =>
				this.closePopover()
			);

			input.addEventListener("keydown", (e) => {
				if (e.key === "Enter") {
					e.preventDefault();
					submitFolder();
				}
			});
			window.setTimeout(() => input.focus(), 15);
			return;
		}

		if (this.popoverMode === "note") {
			this.popoverEl.createDiv({ cls: "hub3d-pop-header", text: "Новая 3D-заметка" });

			let selectedProg = currentProg || "Blender";
			let selectedTopic = this.level.topicPath;

			if (!currentProg) {
				const progRow = this.popoverEl.createDiv({ cls: "hub3d-pop-chips" });
				for (const p of this.getKnownPrograms()) {
					const chip = progRow.createEl("button", {
						cls: "hub3d-pop-chip" + (p === selectedProg ? " is-selected" : ""),
						text: p
					});
					chip.addEventListener("click", () => {
						selectedProg = p;
						progRow.querySelectorAll(".hub3d-pop-chip").forEach((el) => el.removeClass("is-selected"));
						chip.addClass("is-selected");
					});
				}
			} else {
				const contextLabel = selectedTopic ? `${selectedProg} / ${selectedTopic}` : `${selectedProg} (без темы)`;
				this.popoverEl.createDiv({ cls: "hub3d-pop-sub", text: `Раздел: ${contextLabel}` });
			}

			const input = this.popoverEl.createEl("input", {
				type: "text",
				cls: "hub3d-pop-input",
				placeholder: "Название заметки..."
			});

			const createNoteFile = async (openAfter: boolean) => {
				const rawTitle = input.value.trim();
				if (!rawTitle) {
					new Notice("Введи название заметки");
					return;
				}
				if (/[\\/:*?"<>|\x00-\x1f]/.test(rawTitle)) {
					new Notice('В названии нельзя использовать \\ / : * ? " < > |');
					return;
				}

				const folder = normalizePath(this.plugin.settings.targetFolder || "Знания");
				const filePath = normalizePath(`${folder}/${rawTitle}.md`);
				const existing = this.app.vault.getAbstractFileByPath(filePath);
				if (existing) {
					new Notice("Заметка с таким именем уже существует");
					if (openAfter) void this.app.workspace.openLinkText(filePath, "", false);
					return;
				}

				await this.ensureFolderExists(folder);

				const programsYaml =
					this.level.program === "__none__" ? "программы: []" : `программы:\n  - ${JSON.stringify(selectedProg)}`;
				const topicsYaml = selectedTopic ? `темы:\n  - ${JSON.stringify(selectedTopic)}` : "темы: []";

				const content = [
					"---",
					`направление: "${AREA_NAME}"`,
					'тип: "Заметка"',
					programsYaml,
					topicsYaml,
					'источник: ""',
					"---",
					"",
					`# ${rawTitle}`,
					"",
					"## Суть",
					"",
					"",
					"## Пошагово / Ноды",
					"",
					""
				].join("\n");

				const created = await this.app.vault.create(filePath, content);
				this.plugin.scanner.setPending(created.path, {
					направление: AREA_NAME,
					тип: "Заметка",
					программы: this.level.program === "__none__" ? [] : [selectedProg],
					темы: selectedTopic ? [selectedTopic] : []
				});

				this.closePopover();
				this.refresh();
				new Notice(`Создано: «${created.basename}»`);

				if (openAfter) {
					void this.app.workspace.openLinkText(created.path, "", false);
				}
			};

			const actions = this.popoverEl.createDiv({ cls: "hub3d-pop-actions" });
			actions.createEl("button", { cls: "hub3d-dock-btn is-primary", text: "Создать и открыть" }).addEventListener(
				"click",
				() => void createNoteFile(true)
			);
			actions.createEl("button", { cls: "hub3d-dock-btn", text: "На холст" }).addEventListener(
				"click",
				() => void createNoteFile(false)
			);
			actions.createEl("button", { cls: "hub3d-dock-btn", text: "Отмена" }).addEventListener("click", () =>
				this.closePopover()
			);

			input.addEventListener("keydown", (e) => {
				if (e.key === "Enter") {
					e.preventDefault();
					void createNoteFile(!e.shiftKey);
				}
			});
			window.setTimeout(() => input.focus(), 15);
		}
	}

	private async ensureFolderExists(folderPath: string): Promise<void> {
		let current = "";
		for (const part of normalizePath(folderPath).split("/")) {
			current = current ? `${current}/${part}` : part;
			const found = this.app.vault.getAbstractFileByPath(current);
			if (!found) {
				await this.app.vault.createFolder(current);
			} else if (!(found instanceof TFolder)) {
				throw new Error(`Путь занят файлом: ${current}`);
			}
		}
	}

	private getFocusProjectName(): string {
		const prog = this.level.program && this.level.program !== "__none__" ? this.level.program : "";
		const topic = this.level.topicPath.trim();
		if (prog && topic) return `${prog} / ${topic}`;
		if (prog) return prog;
		if (topic) return `${AREA_NAME} / ${topic}`;
		return AREA_NAME;
	}

	private openFocusTracker(): void {
		const winApi = (window as unknown as { __myFocusTracker?: FocusTrackerApi }).__myFocusTracker;
		const pluginApi = (
			this.app as unknown as { plugins?: { getPlugin?: (id: string) => FocusTrackerApi | undefined } }
		).plugins?.getPlugin?.("my-focus-tracker");
		const api = winApi?.openFocusModal ? winApi : pluginApi;
		if (!api?.openFocusModal) {
			new Notice("Плагин my-focus-tracker не активен");
			return;
		}
		api.openFocusModal({ initialProject: this.getFocusProjectName() });
	}

	private renderTopIsland(): void {
		if (!this.topIslandEl) return;
		this.topIslandEl.empty();

		// Кнопка возврата на уровень выше
		if (this.level.program !== null) {
			const backBtn = this.topIslandEl.createEl("button", {
				cls: "hub3d-crumb-btn hub3d-back-btn",
				text: "←"
			});
			backBtn.title = "Назад (Esc)";
			backBtn.addEventListener("click", () => this.navigateUp());
		}

		// Корень "3D"
		const rootBtn = this.topIslandEl.createEl("button", {
			cls: "hub3d-crumb-btn" + (this.level.program === null ? " is-current" : ""),
			text: "3D"
		});
		rootBtn.addEventListener("click", () => {
			this.level = { program: null, topicPath: "" };
			this.engine?.resetCamera();
			this.renderAll();
		});

// Уровень программы (дроп на программу выносит заметку за пределы всех тем — Outside)
		if (this.level.program !== null) {
			this.topIslandEl.createSpan({ cls: "hub3d-crumb-sep", text: "/" });
			const progLabel = this.level.program === "__none__" ? "Вне программ" : this.level.program;
			const progBtn = this.topIslandEl.createEl("button", {
				cls: "hub3d-crumb-btn" + (!this.level.topicPath ? " is-current" : ""),
				text: progLabel
			});
			progBtn.dataset.dropTopic = "";
			progBtn.dataset.dropLabel = `${progLabel} (вне тем)`;
			progBtn.addEventListener("click", () => {
				this.level = { program: this.level.program, topicPath: "" };
				this.engine?.resetCamera();
				this.renderAll();
			});
		}

		// Уровни тем и папок (дроп на крошку темы переносит заметку в корень этой темы/папки)
		if (this.level.topicPath) {
			const parts = topicParts(this.level.topicPath);
			parts.forEach((part, idx) => {
				this.topIslandEl!.createSpan({ cls: "hub3d-crumb-sep", text: "/" });
				const subPath = parts.slice(0, idx + 1).join("/");
				const isLast = idx === parts.length - 1;
				const partBtn = this.topIslandEl!.createEl("button", {
					cls: "hub3d-crumb-btn" + (isLast ? " is-current" : ""),
					text: part
				});
				if (!isLast) {
					partBtn.dataset.dropTopic = subPath;
					partBtn.dataset.dropLabel = part;
				}
				partBtn.addEventListener("click", () => {
					this.level = { program: this.level.program, topicPath: subPath };
					this.engine?.resetCamera();
					this.renderAll();
				});
			});
		}

		// Счётчик заметок
		const programsCount = new Set(this.notes.flatMap((n) => n.programs)).size;
		this.topIslandEl.createSpan({
			cls: "hub3d-crumb-meta",
			text: `${this.notes.length} зам. · ${programsCount} прогр.`
		});

// Кнопка запуска фокуса (my-focus-tracker)
		const focusProject = this.getFocusProjectName();
		const focusBtn = this.topIslandEl.createEl("button", {
			cls: "hub3d-crumb-btn hub3d-crumb-icon-btn"
		});
		setIcon(focusBtn, "timer");
		focusBtn.title = `Фокус: ${focusProject}`;
		focusBtn.setAttribute("aria-label", `Фокус: ${focusProject}`);
		focusBtn.addEventListener("click", () => this.openFocusTracker());

		// Кнопка режима сцепления пузырей (удобно на iPad + подсказка для ПК)
		const isLinkOn = this.engine?.isLinkMode() ?? false;
		const linkBtn = this.topIslandEl.createEl("button", {
			cls: "hub3d-crumb-btn hub3d-crumb-icon-btn" + (isLinkOn ? " is-current" : "")
		});
		setIcon(linkBtn, "link-2");
		linkBtn.title = "Режим сцепления пузырей (или Shift + перетаскивание мышью)";
		linkBtn.setAttribute("aria-label", "Режим сцепления пузырей");
		linkBtn.addEventListener("click", () => {
			if (!this.engine) return;
			const next = !this.engine.isLinkMode();
			this.engine.setLinkMode(next);
			if (next) new Notice("Тапни два пузыря по очереди, чтобы сцепить их");
			this.renderTopIsland();
		});

		// Кнопка центрирования камеры
		const centerBtn = this.topIslandEl.createEl("button", {
			cls: "hub3d-crumb-btn hub3d-crumb-icon-btn"
		});
		setIcon(centerBtn, "crosshair");
		centerBtn.title = "Центрировать холст";
		centerBtn.setAttribute("aria-label", "Центрировать холст");
		centerBtn.addEventListener("click", () => this.engine?.resetCamera());
	}

private async moveNoteToTopic(note: Note3D, targetTopicPath: string): Promise<void> {
		let nextTopics: string[];

		if (!targetTopicPath) {
			// Перенос в "Outside" (вне всех тем и папок)
			nextTopics = [];
		} else {
			const targetRoot = topicParts(targetTopicPath)[0] || "";
			// Заменяем ветку текущей корневой темы на целевой путь (сохраняя возможные другие независимые темы)
			const kept = note.rawTopics.filter((rt) => {
				const mappedRoot = topicParts(mapTopic(rt))[0] || "";
				const currentRoot = topicParts(this.level.topicPath)[0] || "";
				return mappedRoot !== targetRoot && (!currentRoot || mappedRoot !== currentRoot);
			});
			nextTopics = Array.from(new Set([...kept, targetTopicPath]));
		}

		await this.app.fileManager.processFrontMatter(note.file, (fm: Record<string, unknown>) => {
			fm["темы"] = nextTopics;
		});
		this.plugin.scanner.setPending(note.path, { темы: nextTopics });

		// Удаляем сохранённую старую позицию заметки, чтобы она красиво встала в новом месте
		for (const key of Object.keys(this.plugin.settings.bubblePositions)) {
			if (key.endsWith(`::${note.path}`)) {
				delete this.plugin.settings.bubblePositions[key];
			}
		}
		await this.plugin.saveSettings();

		this.refresh();
		new Notice(
			targetTopicPath
				? `«${note.title}» → ${targetTopicPath}`
				: `«${note.title}» вынесена за пределы тем`
		);
	}

	private handleDeleteRequest(node: BubbleNode): void {
		if (node.kind === "note" && node.note) {
			const noteRef = node.note;
			new ConfirmDeleteModal(
				this.app,
				`Точно ли вы хотите удалить заметку «${noteRef.title}» в корзину?`,
				async () => {
					await this.app.vault.trash(noteRef.file, true);
					delete this.plugin.settings.bubblePositions[node.id];
					await this.plugin.saveSettings();
					this.refresh();
					new Notice(`Заметка «${noteRef.title}» удалена`);
				}
			).open();
			return;
		}

		if (node.kind === "topic" || node.kind === "folder") {
			const targetTopicPath = node.targetValue;
			const currentProg = this.level.program;
			const kindLabel = node.kind === "folder" ? "папку" : "тему";

			new ConfirmDeleteModal(
				this.app,
				`Точно ли вы хотите удалить ${kindLabel} «${node.label}»? Сами файлы заметок останутся в хранилище, но привязка к этой ${node.kind === "folder" ? "папке" : "теме"} будет убрана.`,
				async () => {
					// 1. Удаляем из виртуальных тем/папок
					this.plugin.settings.virtualTopics = this.plugin.settings.virtualTopics.filter((vt) => {
						const progMatch = !currentProg || currentProg === "__none__" || vt.program === currentProg || vt.program === "";
						const pathMatch = vt.topicPath === targetTopicPath || vt.topicPath.startsWith(targetTopicPath + "/");
						return !(progMatch && pathMatch);
					});
					delete this.plugin.settings.bubblePositions[node.id];
					await this.plugin.saveSettings();

					// 2. Убираем этот путь темы из frontmatter всех заметок этой программы
					for (const n of this.notes) {
						const inProgram =
							!currentProg ||
							(currentProg === "__none__" ? n.programs.length === 0 : n.programs.includes(currentProg));
						if (!inProgram) continue;

						const hasMatch = n.rawTopics.some((rt) => {
							const mapped = mapTopic(rt);
							return mapped === targetTopicPath || mapped.startsWith(targetTopicPath + "/");
						});

						if (hasMatch) {
							const nextTopics = n.rawTopics.filter((rt) => {
								const mapped = mapTopic(rt);
								return mapped !== targetTopicPath && !mapped.startsWith(targetTopicPath + "/");
							});
							await this.app.fileManager.processFrontMatter(n.file, (fm: Record<string, unknown>) => {
								fm["темы"] = nextTopics;
							});
							this.plugin.scanner.setPending(n.path, { темы: nextTopics });
						}
					}

					this.refresh();
					new Notice(`Удалено: «${node.label}»`);
				}
			).open();
		}
	}

public openInspectorForFile(file: TFile): void {
		const images = extractImagesFromNote(this.app, file);
		if (images.length === 0) {
			new Notice(`В заметке «${file.basename}» не найдено скриншотов`);
			return;
		}
this.inspectorOverlay?.destroy();
		this.engine?.setPaused(true);
		this.inspectorOverlay = new NoteSchemaOverlay(this.app, this.contentEl, file, () => {
			this.inspectorOverlay = null;
			this.engine?.setPaused(false);
		});
		this.inspectorOverlay.open();
	}

private openNodeInspector(note: Note3D): void {
		this.openInspectorForFile(note.file);
	}

	private closeNoteStylePopover(): void {
		if (this.styleOutsideHandler) {
			window.removeEventListener("pointerdown", this.styleOutsideHandler, true);
			this.styleOutsideHandler = undefined;
		}
		this.stylePopoverEl?.remove();
		this.stylePopoverEl = null;
	}

	private openNoteStylePopover(note: Note3D, clientX: number, clientY: number): void {
		this.closeNoteStylePopover();

		const pop = this.contentEl.createDiv({ cls: "hub3d-note-style-popover" });
		this.stylePopoverEl = pop;

		const styles = this.plugin.settings.noteStyles;
		const current = styles[note.path] || {};

		const updateStyle = (patch: { color?: string; icon?: string; iconImage?: string } | null) => {
			if (patch === null) {
				delete styles[note.path];
			} else {
				const next = { ...(styles[note.path] || {}), ...patch };
				if (patch.icon !== undefined) delete next.iconImage;
				if (patch.iconImage !== undefined) delete next.icon;
				styles[note.path] = next;
			}
			void this.plugin.saveSettings();
			this.renderAll();
		};

		// 1. Цвет карточки
		const swRow = pop.createDiv({ cls: "hub3d-style-swatches" });
		for (const c of NOTE_STYLE_COLORS) {
			const sw = swRow.createEl("button", {
				cls: "hub3d-style-swatch" + (current.color === c ? " is-active" : "")
			});
			sw.style.backgroundColor = c;
			sw.addEventListener("click", () => {
				updateStyle({ color: c });
				swRow.querySelectorAll(".hub3d-style-swatch").forEach((el) => el.removeClass("is-active"));
				sw.addClass("is-active");
			});
		}

		// 2. Быстрые 3D-иконки
		const iconRow = pop.createDiv({ cls: "hub3d-style-icons" });
		for (const ic of NOTE_STYLE_ICONS) {
			const btn = iconRow.createEl("button", {
				cls: "hub3d-style-icon-btn" + (current.icon === ic ? " is-active" : ""),
				text: ic
			});
			btn.addEventListener("click", () => {
				updateStyle({ icon: ic });
				iconRow.querySelectorAll(".hub3d-style-icon-btn").forEach((el) => el.removeClass("is-active"));
				btn.addClass("is-active");
			});
		}

		// 3. Выбор своей картинки / Сброс
		const actions = pop.createDiv({ cls: "hub3d-style-actions" });
		const imgBtn = actions.createEl("button", { cls: "hub3d-dock-btn", text: "🖼 Картинка…" });
		imgBtn.addEventListener("click", () => {
			this.closeNoteStylePopover();
			new IconImagePickerModal(this.app, (file) => {
				updateStyle({ iconImage: file.path });
			}).open();
		});

		const resetBtn = actions.createEl("button", { cls: "hub3d-dock-btn", text: "Сбросить" });
		resetBtn.addEventListener("click", () => {
			updateStyle(null);
			this.closeNoteStylePopover();
		});

		// Позиционирование внутри окна по фактическим размерам поповера
		const rootRect = this.contentEl.getBoundingClientRect();
		const popW = pop.offsetWidth || 248;
		const popH = pop.offsetHeight || 156;
		const left = Math.max(12, Math.min(rootRect.width - popW - 12, clientX - rootRect.left + 8));
		const top = Math.max(12, Math.min(rootRect.height - popH - 12, clientY - rootRect.top - 12));
		pop.style.left = `${Math.round(left)}px`;
		pop.style.top = `${Math.round(top)}px`;

		this.styleOutsideHandler = (e: PointerEvent) => {
			if (!this.stylePopoverEl?.contains(e.target as Node)) {
				this.closeNoteStylePopover();
			}
		};
		window.setTimeout(() => {
			if (this.styleOutsideHandler) {
				window.addEventListener("pointerdown", this.styleOutsideHandler, true);
			}
		}, 10);
	}
}