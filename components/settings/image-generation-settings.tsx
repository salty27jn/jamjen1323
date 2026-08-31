"use client";

import { useCallback, useEffect, useMemo, useState, type CSSProperties } from "react";
import { AlertCircle, Camera, ChevronDown, Image, ImageOff, RefreshCw, Sparkles, Trash2, Upload } from "lucide-react";
import type { ImageGenerationSettings as ImageGenerationSettingsType } from "@/lib/settings-types";
import {
    DEFAULT_IMAGE_GENERATION_SETTINGS,
    DEFAULT_NOVELAI_PRESET,
    loadImageGenerationSettings,
    saveImageGenerationSettings,
} from "@/lib/settings-storage";
import { loadCharacters } from "@/lib/character-storage";
import type { Character } from "@/lib/character-types";
import { getChatImageFromIndexedDB, saveChatImageToIndexedDB } from "@/lib/chat-asset-storage";
import {
    fetchImageGenerationModels,
    fetchNovelAiModels,
    filterLikelyImageModels,
    generateImageFromConfiguredApi,
} from "@/lib/image-generation-service";
import { Alert } from "@/components/ui/feedback";
import { Input, Select, Textarea, Toggle } from "@/components/ui/form";
import { isNoPhotoEnabled, setNoPhotoEnabled } from "@/custom/no-photo";
import { ConfirmDialog } from "@/components/ui/modal";
import {
    NOVELAI_COMMON_MODELS,
    NOVELAI_NOISE_SCHEDULE_OPTIONS,
    NOVELAI_RESOLUTION_OPTIONS,
    NOVELAI_SAMPLER_OPTIONS,
} from "@/lib/novelai-image-config";

const SIZE_OPTIONS = ["auto", "1024x1024", "1024x1536", "1536x1024"];
const QUALITY_OPTIONS = ["auto", "low", "medium", "high"];

// Some relay APIs (e.g. dzzi 鐨?gpt-image-2) ignore the `size` param and pick
// their own aspect ratio. As a fallback we append a natural-language ratio hint
// to the prompt, which these models DO respect. The marker lets us replace the
// previously-appended hint instead of stacking them when the size changes.
const RATIO_HINT_MARKER = "銆愮敾闈㈡瘮渚嬨€?;
const SIZE_RATIO_HINTS: Record<string, string> = {
    "1024x1024": "姝ｆ柟褰?1:1 鏋勫浘锛宻quare 1:1 composition",
    "1024x1536": "绔栧悜 2:3 鏋勫浘锛寁ertical portrait composition",
    "1536x1024": "妯悜 3:2 鏋勫浘锛宧orizontal landscape composition",
};

// Remove any auto-appended ratio hint line(s), preserving the user's own text.
function stripRatioHint(text: string): string {
    return text.replace(new RegExp(`\\s*${RATIO_HINT_MARKER}[^\\n]*`, "g"), "").replace(/\s+$/, "");
}

// Return the prompt with the ratio hint for `size` appended (replacing any
// previous hint). `auto` strips the hint entirely.
function withRatioHint(extraPrompt: string, size: string): string {
    const base = stripRatioHint(extraPrompt);
    const hint = SIZE_RATIO_HINTS[size];
    if (!hint) return base;
    return base ? `${base}\n${RATIO_HINT_MARKER}${hint}` : `${RATIO_HINT_MARKER}${hint}`;
}
const IMAGE_HOSTING_PROVIDER_OPTIONS = [
    { value: "none", label: "涓嶄娇鐢ㄥ浘搴? },
    { value: "imgbb", label: "ImgBB" },
] as const;
const imageGenerationIconStyle = { "--icon-color": "#0EA5E9" } as CSSProperties;

type Status = { success: boolean; message: string };

export function ImageGenerationSettings() {
    const [settings, setSettings] = useState<ImageGenerationSettingsType>(DEFAULT_IMAGE_GENERATION_SETTINGS);
    const [characters, setCharacters] = useState<Character[]>([]);
    const [noPhoto, setNoPhoto] = useState<boolean>(false);
    const [referencePreviews, setReferencePreviews] = useState<Record<string, string>>({});
    const [models, setModels] = useState<string[]>([]);
    const [isFetchingModels, setIsFetchingModels] = useState(false);
    const [naiModels, setNaiModels] = useState<string[]>(NOVELAI_COMMON_MODELS);
    const [isFetchingNaiModels, setIsFetchingNaiModels] = useState(false);
    const [isTesting, setIsTesting] = useState(false);
    const [status, setStatus] = useState<Status | null>(null);
    const [naiTokenStatus, setNaiTokenStatus] = useState<Status | null>(null);
    const [testPreviewUrl, setTestPreviewUrl] = useState<string | null>(null);
    const [pendingDeletePresetId, setPendingDeletePresetId] = useState<string | null>(null);

    useEffect(() => {
        // Sync the ratio hint to the saved size on load, so the hint is present
        // by default (not only after the user manually switches the size).
        const loaded = loadImageGenerationSettings();
        setNoPhoto(isNoPhotoEnabled());
        const syncedExtra = withRatioHint(loaded.extraPrompt, loaded.size);
        if (syncedExtra !== loaded.extraPrompt) {
            const next = { ...loaded, extraPrompt: syncedExtra };
            saveImageGenerationSettings(next);
            setSettings(next);
        } else {
            setSettings(loaded);
        }
        setCharacters(loadCharacters());
    }, []);

    useEffect(() => {
        let cancelled = false;
        const refs = settings.characterReferences || {};
        Promise.all(Object.entries(refs).map(async ([characterId, ref]) => {
            const dataUrl = ref.assetId ? await getChatImageFromIndexedDB(ref.assetId) : null;
            return [characterId, dataUrl] as const;
        })).then(entries => {
            if (cancelled) return;
            const next: Record<string, string> = {};
            for (const [characterId, dataUrl] of entries) {
                if (dataUrl) next[characterId] = dataUrl;
            }
            setReferencePreviews(next);
        });
        return () => { cancelled = true; };
    }, [settings.characterReferences]);

    useEffect(() => {
        return () => {
            if (testPreviewUrl) URL.revokeObjectURL(testPreviewUrl);
        };
    }, [testPreviewUrl]);

    const persist = useCallback((next: ImageGenerationSettingsType) => {
        setSettings(next);
        saveImageGenerationSettings(next);
    }, []);

    const updateSettings = useCallback((patch: Partial<ImageGenerationSettingsType>) => {
        persist({ ...settings, ...patch });
    }, [persist, settings]);

    // NovelAI 棰勮绠＄悊涓庣姸鎬?
    const naiSettings = useMemo(() => {
        const nai = settings.novelai;
        const presets = nai?.presets && nai.presets.length > 0 ? nai.presets : [DEFAULT_NOVELAI_PRESET];
        const activePreset = presets.find(p => p.id === nai?.activePresetId) || presets[0];
        return {
            apiKey: nai?.apiKey || "",
            activePresetId: activePreset.id,
            presets,
            activePreset,
        };
    }, [settings.novelai]);

    const updateNovelAi = useCallback((patch: Partial<import("@/lib/settings-types").NovelAiSettings>) => {
        persist({
            ...settings,
            novelai: {
                apiKey: naiSettings.apiKey,
                activePresetId: naiSettings.activePresetId,
                presets: naiSettings.presets,
                ...patch,
            },
        });
    }, [naiSettings, persist, settings]);

    const updateActivePreset = useCallback((patch: Partial<NovelAiPreset>) => {
        const nextPresets = naiSettings.presets.map(p => {
            if (p.id === naiSettings.activePresetId) {
                return { ...p, ...patch };
            }
            return p;
        });
        updateNovelAi({ presets: nextPresets });
    }, [naiSettings, updateNovelAi]);

    const addPreset = useCallback(() => {
        const newId = `preset_nai_${Date.now()}`;
        const newPreset: NovelAiPreset = {
            ...naiSettings.activePreset,
            id: newId,
            name: `${naiSettings.activePreset.name} (鍓湰)`,
        };
        updateNovelAi({
            presets: [...naiSettings.presets, newPreset],
            activePresetId: newId,
        });
    }, [naiSettings, updateNovelAi]);

    const deletePreset = useCallback((presetId: string) => {
        if (naiSettings.presets.length <= 1) return;
        const deletedIndex = naiSettings.presets.findIndex(p => p.id === presetId);
        if (deletedIndex < 0) return;
        const nextPresets = naiSettings.presets.filter(p => p.id !== presetId);
        const nextActivePreset = nextPresets[Math.min(deletedIndex, nextPresets.length - 1)];
        updateNovelAi({
            presets: nextPresets,
            activePresetId: nextActivePreset.id,
        });
    }, [naiSettings, updateNovelAi]);

    // Changing the size also refreshes the auto-appended ratio hint in the
    // 琛ュ厖鎻愮ず璇?box (replacing any previous hint), so models that ignore the
    // `size` param still produce the requested orientation.
    const applySize = useCallback((size: string) => {
        persist({ ...settings, size, extraPrompt: withRatioHint(settings.extraPrompt, size) });
    }, [persist, settings]);

    const updateImageHosting = useCallback((patch: Partial<ImageGenerationSettingsType["imageHosting"]>) => {
        persist({
            ...settings,
            imageHosting: {
                ...settings.imageHosting,
                ...patch,
            },
        });
    }, [persist, settings]);

    const likelyModels = useMemo(() => filterLikelyImageModels(models), [models]);

    const fetchModels = async () => {
        setStatus(null);
        if (!settings.apiKey.trim() || !settings.baseUrl.trim()) {
            setStatus({ success: false, message: "璇峰厛濉啓 Base URL 鍜?API Key銆? });
            return;
        }
        setIsFetchingModels(true);
        try {
            const fetched = await fetchImageGenerationModels(settings);
            setModels(fetched);
            setStatus({
                success: true,
                message: fetched.length > 0 ? `宸叉媺鍙?${fetched.length} 涓ā鍨嬨€俙 : "鎺ュ彛杩斿洖涓虹┖锛屽彲鎵嬪姩濉啓妯″瀷鍚嶃€?,
            });
        } catch (err) {
            setModels([]);
            setStatus({ success: false, message: err instanceof Error ? err.message : String(err) });
        } finally {
            setIsFetchingModels(false);
        }
    };

    const fetchNaiModels = async () => {
        setNaiTokenStatus(null);
        if (!naiSettings.apiKey.trim()) {
            setNaiTokenStatus({ success: false, message: "璇峰厛濉啓 NovelAI API Token銆? });
            return;
        }
        setIsFetchingNaiModels(true);
        try {
            const fetched = await fetchNovelAiModels(naiSettings.apiKey);
            setNaiModels(fetched);
            setNaiTokenStatus({
                success: true,
                message: `NovelAI Token 鏈夋晥锛屽凡鍔犺浇 ${fetched.length} 涓父鐢ㄦā鍨嬨€俙,
            });
        } catch (err) {
            setNaiTokenStatus({ success: false, message: err instanceof Error ? err.message : String(err) });
        } finally {
            setIsFetchingNaiModels(false);
        }
    };

    const testGeneration = async () => {
        setStatus(null);
        setIsTesting(true);
        try {
            const result = await generateImageFromConfiguredApi({
                description: settings.provider === "novelai"
                    ? "1girl, solo, upper body, white coffee cup on the wooden table, soft window light"
                    : "涓€寮犳斁鍦ㄦ闈笂鐨勭櫧鑹插挅鍟℃澂锛屾煍鍜岃嚜鐒跺厜锛岀湡瀹炵収鐗囬鏍?,
                settings: { ...settings, enabled: true },
            });
            if (!result) throw new Error("鍥惧儚鐢熸垚鏈繑鍥炵粨鏋溿€?);
            if (testPreviewUrl) URL.revokeObjectURL(testPreviewUrl);
            setTestPreviewUrl(URL.createObjectURL(result.blob));
            setStatus({ success: true, message: "娴嬭瘯鐢熷浘鎴愬姛銆? });
        } catch (err) {
            setStatus({ success: false, message: err instanceof Error ? err.message : String(err) });
        } finally {
            setIsTesting(false);
        }
    };

    const uploadReference = async (characterId: string, file: File) => {
        const assetId = await saveChatImageToIndexedDB(file);
        persist({
            ...settings,
            characterReferences: {
                ...(settings.characterReferences || {}),
                [characterId]: { assetId, updatedAt: Date.now() },
            },
        });
    };

    const removeReference = (characterId: string) => {
        const nextRefs = { ...(settings.characterReferences || {}) };
        delete nextRefs[characterId];
        persist({ ...settings, characterReferences: nextRefs });
        setReferencePreviews(prev => {
            const next = { ...prev };
            delete next[characterId];
            return next;
        });
    };

    return (
        <div className="flex flex-col gap-6 pb-8">
            <div className="flex items-center">
                <h2 className="m-0 mx-2 ts-28 font-bold italic leading-none text-black">Image Generation</h2>
            </div>

            <div className="menu-group">
                <div className="menu-item">
                    <span className="card-icon" style={imageGenerationIconStyle}>
                        <Sparkles size={22} strokeWidth={1.75} />
                    </span>
                    <span className="settings-tools-menu-copy">
                        <span className="menu-label appearance-menu-item-label">鍚敤鑷姩鐢熷浘</span>
                        <span className="menu-desc settings-tools-menu-desc">瑙掕壊杈撳嚭鐓х墖鏍囩鏃惰嚜鍔ㄨ皟鐢ㄥ浘鍍忕敓鎴?API銆?/span>
                    </span>
                    <span className="menu-right settings-tools-menu-toggle">
                        <Toggle checked={settings.enabled} onChange={(enabled) => updateSettings({ enabled })} className="settings-toggle-control" />
                    </span>
                </div>
                <div className="menu-item">
                    <span className="card-icon" style={imageGenerationIconStyle}>
                        <ImageOff size={22} strokeWidth={1.75} />
                    </span>
                    <span className="settings-tools-menu-copy">
                        <span className="menu-label appearance-menu-item-label">绂佹瑙掕壊鍙戠収鐗?/span>
                        <span className="menu-desc settings-tools-menu-desc">鑱婂ぉ涓庢湅鍙嬪湀涓笉鍐嶅嚭鐜扮収鐗囨爣绛惧強鍥剧墖鎻忚堪鏂囧瓧銆?/span>
                    </span>
                    <span className="menu-right settings-tools-menu-toggle">
                        <Toggle checked={noPhoto} onChange={(enabled) => { setNoPhoto(enabled); setNoPhotoEnabled(enabled); }} className="settings-toggle-control" />
                    </span>
                </div>
            </div>

            <div className="menu-group p-4 flex flex-col gap-4">
                <div className="flex flex-col gap-1">
                    <label className="menu-desc ml-1">鐢熷浘鎻愪緵鏂?/ 寮曟搸</label>
                    <Select
                        value={settings.provider || "openai"}
                        onChange={(event) => updateSettings({
                            provider: event.target.value as "openai" | "novelai",
                        })}
                    >
                        <option value="openai">OpenAI 鍏煎 (閫氱敤妯″瀷 / DALL-E / Flux / SD 涓浆绛?</option>
                        <option value="novelai">NovelAI 鍘熺敓鎺ュ彛 (瀹樻柟 API)</option>
                    </Select>
                </div>

                <div className="flex flex-col gap-1">
                    <label className="menu-desc ml-1">璇锋眰鏂瑰紡</label>
                    <Select
                        value={settings.requestMode}
                        onChange={(event) => updateSettings({
                            requestMode: event.target.value as ImageGenerationSettingsType["requestMode"],
                        })}
                    >
                        <option value="server">鏈嶅姟绔浆鍙戯紙鎺ㄨ崘锛屽彲閬垮厤璺ㄥ煙鎶ラ敊锛?/option>
                        <option value="direct">娴忚鍣ㄧ洿杩烇紙闇€鎺ュ彛鍏佽 CORS 璺ㄥ煙锛?/option>
                    </Select>
                </div>

                {settings.provider === "novelai" ? (
                    /* --- NovelAI 閰嶇疆闈㈡澘 --- */
                    <>
                        <div className="flex flex-col gap-1">
                            <label className="menu-desc ml-1">NovelAI API Token</label>
                            <Input
                                type="password"
                                value={naiSettings.apiKey}
                                onChange={(event) => {
                                    updateNovelAi({ apiKey: event.target.value });
                                    setNaiTokenStatus(null);
                                }}
                                placeholder="pst-..."
                            />
                            <span className="menu-desc ml-1">鍙湪 NovelAI 瀹樼綉 Account 椤甸潰鑾峰彇 Persistent API Token銆?/span>
                            {naiTokenStatus && (
                                <div role={naiTokenStatus.success ? "status" : "alert"} className="mt-2">
                                    <Alert variant={naiTokenStatus.success ? "success" : "danger"}>
                                        <AlertCircle size={16} className="mt-[2px] shrink-0" />
                                        <span className="break-all leading-[1.5]">{naiTokenStatus.message}</span>
                                    </Alert>
                                </div>
                            )}
                        </div>

                        {/* 棰勮绠＄悊鏍?*/}
                        <div className="flex flex-col gap-2 rounded-xl bg-[var(--c-input)]/40 p-3 border border-[var(--c-card-border)]">
                            <div className="flex flex-col items-stretch gap-2 sm:flex-row sm:items-center sm:justify-between">
                                <label className="menu-label text-sm font-semibold">NovelAI 鍙傛暟棰勮</label>
                                <div className="grid grid-cols-2 gap-2 sm:flex sm:items-center">
                                    <button
                                        type="button"
                                        onClick={addPreset}
                                        className="ui-btn ui-btn-soft-action min-h-11 !px-3 !py-2 text-xs flex items-center gap-1"
                                        title="澶嶅埗褰撳墠涓烘柊棰勮"
                                    >
                                        <Plus size={14} />
                                        鏂板缓棰勮
                                    </button>
                                    {naiSettings.presets.length > 1 && (
                                        <button
                                            type="button"
                                            onClick={() => setPendingDeletePresetId(naiSettings.activePresetId)}
                                            className="ui-btn ui-btn-danger min-h-11 !px-3 !py-2 text-xs flex items-center gap-1"
                                            title="鍒犻櫎褰撳墠閫変腑鐨勯璁?
                                        >
                                            <Trash2 size={14} />
                                            鍒犻櫎棰勮
                                        </button>
                                    )}
                                </div>
                            </div>

                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                                <div className="flex flex-col gap-1">
                                    <span className="menu-desc ml-1">鍒囨崲褰撳墠棰勮</span>
                                    <Select
                                        value={naiSettings.activePresetId}
                                        onChange={(event) => updateNovelAi({ activePresetId: event.target.value })}
                                    >
                                        {naiSettings.presets.map(p => (
                                            <option key={p.id} value={p.id}>{p.name}</option>
                                        ))}
                                    </Select>
                                </div>
                                <div className="flex flex-col gap-1">
                                    <span className="menu-desc ml-1">棰勮鍚嶇О</span>
                                    <Input
                                        type="text"
                                        value={naiSettings.activePreset.name}
                                        onChange={(event) => updateActivePreset({ name: event.target.value })}
                                        placeholder="棰勮鍚嶇О"
                                    />
                                </div>
                            </div>
                        </div>

                        {/* 棰勮璇︾粏鍙傛暟 */}
                        <div className="flex flex-col gap-1">
                            <label className="menu-desc ml-1">妯″瀷 (Model)</label>
                            <div className="flex gap-2">
                                <div className="relative flex-1">
                                    <Input
                                        type="text"
                                        value={naiSettings.activePreset.model}
                                        onChange={(event) => updateActivePreset({ model: event.target.value })}
                                        placeholder="nai-diffusion-4-curated-preview"
                                        className={naiModels.length > 0 ? "w-full pr-9" : "w-full"}
                                    />
                                    {naiModels.length > 0 && (
                                        <>
                                            <ChevronDown size={16} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 opacity-60" />
                                            <select
                                                aria-label="閫夋嫨甯歌 NAI 妯″瀷"
                                                value=""
                                                onChange={(event) => {
                                                    if (event.target.value) updateActivePreset({ model: event.target.value });
                                                }}
                                                className="absolute inset-y-0 right-0 w-10 cursor-pointer opacity-0"
                                            >
                                                <option value="">蹇€熼€夋嫨妯″瀷...</option>
                                                {naiModels.map(m => (
                                                    <option key={m} value={m}>{m}</option>
                                                ))}
                                            </select>
                                        </>
                                    )}
                                </div>
                                <button
                                    type="button"
                                    onClick={fetchNaiModels}
                                    disabled={isFetchingNaiModels}
                                    className="ui-btn ui-btn-soft-action min-h-11 shrink-0"
                                >
                                    <RefreshCw size={16} className={isFetchingNaiModels ? "animate-spin" : ""} />
                                    {isFetchingNaiModels ? "楠岃瘉涓? : "楠岃瘉 Token"}
                                </button>
                            </div>
                            <span className="menu-desc ml-1 opacity-70">妯″瀷涓嬫媺鍒楄〃鍐呯疆浜庡簲鐢紱鈥滈獙璇?Token鈥濆彧妫€鏌ュ嚟璇侊紝涓嶄細鍙戣捣鐢熷浘銆?/span>
                        </div>

                        <div className="flex flex-col gap-1">
                            <label className="menu-desc ml-1">鍒嗚鲸鐜?(Resolution)</label>
                            <Select
                                value={naiSettings.activePreset.resolution}
                                onChange={(event) => updateActivePreset({ resolution: event.target.value })}
                            >
                                {NOVELAI_RESOLUTION_OPTIONS.map(opt => (
                                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                                ))}
                            </Select>
                        </div>

                        <div className="grid grid-cols-2 gap-3">
                            <div className="flex flex-col gap-1">
                                <label className="menu-desc ml-1">閲囨牱鍣?(Sampler)</label>
                                <Select
                                    value={naiSettings.activePreset.sampler}
                                    onChange={(event) => updateActivePreset({ sampler: event.target.value })}
                                >
                                    {NOVELAI_SAMPLER_OPTIONS.map(opt => (
                                        <option key={opt.value} value={opt.value}>{opt.label}</option>
                                    ))}
                                </Select>
                            </div>

                            <div className="flex flex-col gap-1">
                                <label className="menu-desc ml-1">璋冨害鍣?(Schedule)</label>
                                <Select
                                    value={naiSettings.activePreset.noiseSchedule || "karras"}
                                    onChange={(event) => updateActivePreset({ noiseSchedule: event.target.value })}
                                >
                                    {NOVELAI_NOISE_SCHEDULE_OPTIONS.map(opt => (
                                        <option key={opt.value} value={opt.value}>{opt.label}</option>
                                    ))}
                                </Select>
                            </div>
                        </div>

                        <div className="grid grid-cols-2 gap-3">
                            <div className="flex flex-col gap-1">
                                <label className="menu-desc ml-1">姝ユ暟 (Steps: {naiSettings.activePreset.steps})</label>
                                <Input
                                    type="number"
                                    min={1}
                                    max={50}
                                    value={naiSettings.activePreset.steps}
                                    onChange={(event) => updateActivePreset({
                                        steps: Math.max(1, Math.min(50, parseInt(event.target.value, 10) || 28)),
                                    })}
                                />
                            </div>

                            <div className="flex flex-col gap-1">
                                <label className="menu-desc ml-1">鎻愮ず璇嶇浉鍏冲害 (CFG Scale: {naiSettings.activePreset.scale})</label>
                                <Input
                                    type="number"
                                    min={1}
                                    max={30}
                                    step={0.1}
                                    value={naiSettings.activePreset.scale}
                                    onChange={(event) => updateActivePreset({
                                        scale: Math.max(1, Math.min(30, parseFloat(event.target.value) || 6.0)),
                                    })}
                                />
                            </div>
                        </div>

                        <div className="flex flex-col gap-1">
                            <label className="menu-desc ml-1">鐢诲笀涓?/ 姝ｉ潰璐ㄩ噺鎻愮ず璇?(Positive / Quality)</label>
                            <Textarea
                                value={naiSettings.activePreset.positivePrompt}
                                onChange={(event) => updateActivePreset({ positivePrompt: event.target.value })}
                                placeholder="masterpiece, best quality, very aesthetic, artist:..."
                                rows={3}
                            />
                            <span className="menu-desc ml-1 opacity-70">
                                浼氫綔涓哄熀纭€椋庢牸涓庤鑹茶亰澶╃殑鐢婚潰鎻忚堪缁勫悎鍙戦€併€?
                            </span>
                        </div>

                        <div className="flex flex-col gap-1">
                            <label className="menu-desc ml-1">璐熼潰鎻愮ず璇?(Undesired Content / Negative)</label>
                            <Textarea
                                value={naiSettings.activePreset.negativePrompt}
                                onChange={(event) => updateActivePreset({ negativePrompt: event.target.value })}
                                placeholder="lowres, bad anatomy, bad hands, blurry..."
                                rows={3}
                            />
                        </div>

                        <div className="grid grid-cols-2 gap-2 pt-1">
                            <label className="flex min-h-11 items-center gap-2 cursor-pointer">
                                <input
                                    type="checkbox"
                                    checked={naiSettings.activePreset.qualityToggle !== false}
                                    onChange={(e) => updateActivePreset({ qualityToggle: e.target.checked })}
                                    className="rounded border-[var(--c-card-border)]"
                                />
                                <span className="text-xs font-medium">鍚敤璐ㄩ噺璇?(Quality+)</span>
                            </label>
                            <label className="flex min-h-11 items-center gap-2 cursor-pointer">
                                <input
                                    type="checkbox"
                                    checked={naiSettings.activePreset.smea === true}
                                    onChange={(e) => updateActivePreset({ smea: e.target.checked })}
                                    className="rounded border-[var(--c-card-border)]"
                                />
                                <span className="text-xs font-medium">鍚敤 SMEA</span>
                            </label>
                        </div>
                    </>
                ) : (
                    /* --- OpenAI 妯″紡閰嶇疆闈㈡澘 --- */
                    <>
                        <div className="flex flex-col gap-1">
                            <label className="menu-desc ml-1">Base URL</label>
                            <Input
                                type="url"
                                value={settings.baseUrl}
                                onChange={(event) => updateSettings({ baseUrl: event.target.value })}
                                placeholder="https://api.example.com/v1"
                            />
                        </div>

                        <div className="flex flex-col gap-1">
                            <label className="menu-desc ml-1">API Key</label>
                            <Input
                                type="password"
                                value={settings.apiKey}
                                onChange={(event) => updateSettings({ apiKey: event.target.value })}
                                placeholder="sk-..."
                            />
                        </div>

                        <div className="flex flex-col gap-1">
                            <label className="menu-desc ml-1">妯″瀷鍚?/label>
                            <div className="flex gap-2">
                                <div className="relative flex-1">
                                    <Input
                                        type="text"
                                        value={settings.model}
                                        onChange={(event) => updateSettings({ model: event.target.value })}
                                        placeholder="gpt-image-2 / image2 / chatgpt-image-latest"
                                        className={likelyModels.length > 0 ? "w-full pr-9" : "w-full"}
                                    />
                                    {likelyModels.length > 0 && (
                                        <>
                                            <ChevronDown size={16} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 opacity-60" />
                                            <select
                                                aria-label="閫夋嫨鎷夊彇鍒扮殑妯″瀷"
                                                value=""
                                                onChange={(event) => {
                                                    if (event.target.value) updateSettings({ model: event.target.value });
                                                }}
                                                className="absolute inset-y-0 right-0 w-10 cursor-pointer opacity-0"
                                            >
                                                <option value="">閫夋嫨鎷夊彇鍒扮殑妯″瀷...</option>
                                                {likelyModels.map(model => <option key={model} value={model}>{model}</option>)}
                                            </select>
                                        </>
                                    )}
                                </div>
                                <button
                                    type="button"
                                    onClick={fetchModels}
                                    disabled={isFetchingModels}
                                    className="ui-btn ui-btn-soft-action shrink-0"
                                >
                                    <RefreshCw size={16} className={isFetchingModels ? "animate-spin" : ""} />
                                    {isFetchingModels ? "鎷夊彇涓? : "鎷夊彇妯″瀷"}
                                </button>
                            </div>
                        </div>

                        <div className="grid grid-cols-2 gap-3">
                            <div className="flex flex-col gap-1">
                                <label className="menu-desc ml-1">灏哄</label>
                                <Select value={settings.size} onChange={(event) => applySize(event.target.value)}>
                                    {SIZE_OPTIONS.map(option => <option key={option} value={option}>{option}</option>)}
                                </Select>
                            </div>
                            <div className="flex flex-col gap-1">
                                <label className="menu-desc ml-1">璐ㄩ噺</label>
                                <Select value={settings.quality} onChange={(event) => updateSettings({ quality: event.target.value })}>
                                    {QUALITY_OPTIONS.map(option => <option key={option} value={option}>{option}</option>)}
                                </Select>
                            </div>
                        </div>

                        <div className="flex flex-col gap-1">
                            <label className="menu-desc ml-1">琛ュ厖鎻愮ず璇?/label>
                            <Textarea
                                value={settings.extraPrompt}
                                onChange={(event) => updateSettings({ extraPrompt: event.target.value })}
                                placeholder="浼氬拰瑙掕壊杈撳嚭鐨勫浘鐗囨弿杩颁竴璧峰彂閫佺粰鐢熷浘妯″瀷銆?
                                rows={4}
                            />
                            <p className="menu-desc ml-1 opacity-70">
                                閫夋嫨灏哄鍚庝細鑷姩鍦ㄦ湯灏捐拷鍔犱竴鍙ャ€寋RATIO_HINT_MARKER}鈥︺€嶆瀯鍥炬彁绀猴紝鐢ㄤ簬绾犳閮ㄥ垎涓嶈 size 鍙傛暟鐨勬帴鍙ｏ紙濡?gpt-image-2锛夈€傚彲鎵嬪姩淇敼鎴栧垹闄ゃ€?
                            </p>
                        </div>
                    </>
                )}

                <div className="flex gap-3">
                    <button
                        type="button"
                        onClick={testGeneration}
                        disabled={isTesting}
                        className="ui-btn ui-btn-success flex-1"
                    >
                        <Image size={16} />
                        {isTesting ? "娴嬭瘯涓?.." : "娴嬭瘯鐢熷浘"}
                    </button>
                </div>

                {status && (
                    <div role={status.success ? "status" : "alert"}>
                        <Alert variant={status.success ? "success" : "danger"}>
                            <AlertCircle size={16} className="mt-[2px] shrink-0" />
                            <span className="break-all leading-[1.5]">{status.message}</span>
                        </Alert>
                    </div>
                )}
                {testPreviewUrl && (
                    <img
                        src={testPreviewUrl}
                        alt="娴嬭瘯鐢熷浘缁撴灉"
                        className="max-h-[220px] max-w-full self-start rounded-xl border border-[var(--c-card-border)] object-contain"
                    />
                )}
            </div>

            <div className="flex flex-col gap-2">
                <p className="settings-menu-section-title">Image Hosting</p>
                <div className="menu-group">
                    <div className="menu-item">
                        <span className="card-icon" style={imageGenerationIconStyle}>
                            <Upload size={22} strokeWidth={1.75} />
                        </span>
                        <span className="settings-tools-menu-copy">
                            <span className="menu-label appearance-menu-item-label">鍏佽灏忓嵎涓婁紶鍥惧簥</span>
                            <span className="menu-desc settings-tools-menu-desc">寮€鍚悗锛屽皬鍗风殑鍥惧儚澶勭悊濂椾欢鍙互鎶婃湰鍦扮礌鏉愪笂浼犲埌鍏紑鍥惧簥骞舵嬁 URL 鍐?CSS銆?/span>
                        </span>
                        <span className="menu-right settings-tools-menu-toggle">
                            <Toggle
                                checked={settings.imageHosting.allowMascotUpload}
                                onChange={(allowMascotUpload) => updateImageHosting({ allowMascotUpload })}
                                className="settings-toggle-control"
                            />
                        </span>
                    </div>
                </div>

                <div className="menu-group p-4 flex flex-col gap-4">
                    <div className="flex flex-col gap-1">
                        <label className="menu-desc ml-1">鍥惧簥鎻愪緵鏂?/label>
                        <Select
                            value={settings.imageHosting.provider}
                            onChange={(event) => updateImageHosting({
                                provider: event.target.value as ImageGenerationSettingsType["imageHosting"]["provider"],
                            })}
                        >
                            {IMAGE_HOSTING_PROVIDER_OPTIONS.map(option => (
                                <option key={option.value} value={option.value}>{option.label}</option>
                            ))}
                        </Select>
                    </div>

                    <div className="flex flex-col gap-1">
                        <label className="menu-desc ml-1">ImgBB API Key</label>
                        <Input
                            type="password"
                            value={settings.imageHosting.imgbbApiKey}
                            onChange={(event) => updateImageHosting({ imgbbApiKey: event.target.value })}
                            placeholder="浠?imgbb.com/api/1 鑾峰彇"
                            disabled={settings.imageHosting.provider !== "imgbb"}
                        />
                        <span className="menu-desc ml-1">Key 鍙繚瀛樺湪褰撳墠椤圭洰璁剧疆閲岋紱灏忓嵎宸ュ叿缁撴灉涓嶄細鏄剧ず瀹冦€?/span>
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                        <div className="flex flex-col gap-1">
                            <label className="menu-desc ml-1">榛樿杩囨湡绉掓暟</label>
                            <Input
                                type="number"
                                min={0}
                                max={15552000}
                                value={settings.imageHosting.defaultExpirationSeconds}
                                onChange={(event) => updateImageHosting({
                                    defaultExpirationSeconds: Math.max(0, Number.parseInt(event.target.value, 10) || 0),
                                })}
                                disabled={settings.imageHosting.provider !== "imgbb"}
                            />
                            <span className="menu-desc ml-1">0 琛ㄧず涓嶈繃鏈熴€?/span>
                        </div>
                        <div className="flex flex-col gap-1">
                            <label className="menu-desc ml-1">涓婁紶涓婇檺 KB</label>
                            <Input
                                type="number"
                                min={64}
                                max={32768}
                                value={Math.round(settings.imageHosting.maxUploadBytes / 1024)}
                                onChange={(event) => updateImageHosting({
                                    maxUploadBytes: Math.max(64, Number.parseInt(event.target.value, 10) || 900) * 1024,
                                })}
                                disabled={settings.imageHosting.provider !== "imgbb"}
                            />
                            <span className="menu-desc ml-1">榛樿 900KB锛岄€傚悎 CSS 涓婚绱犳潗銆?/span>
                        </div>
                    </div>

                    <div className="menu-item !px-0 !py-0">
                        <span className="settings-tools-menu-copy">
                            <span className="menu-label appearance-menu-item-label">涓婁紶鍓嶈嚜鍔ㄨ浆 WebP</span>
                            <span className="menu-desc settings-tools-menu-desc">鍑忓皬 PNG/JPEG 浣撶Н锛汫IF 浼氫繚鐣欏師鏍煎紡銆?/span>
                        </span>
                        <span className="menu-right settings-tools-menu-toggle">
                            <Toggle
                                checked={settings.imageHosting.autoConvertToWebp}
                                onChange={(autoConvertToWebp) => updateImageHosting({ autoConvertToWebp })}
                                className="settings-toggle-control"
                                disabled={settings.imageHosting.provider !== "imgbb"}
                            />
                        </span>
                    </div>
                </div>
            </div>

            {settings.provider === "novelai" ? (
                <div className="flex flex-col gap-2">
                    <p className="settings-menu-section-title">Character References</p>
                    <Alert variant="info">
                        <Info size={16} className="mt-[2px] shrink-0" />
                        <span className="leading-[1.5]">NovelAI 褰撳墠浠呬娇鐢ㄦ枃瀛楁彁绀鸿瘝鐢熸垚鍥剧墖锛屼笉浼氳鍙栬鑹插弬鑰冨浘銆傚凡鏈夊弬鑰冨浘浼氫繚鐣欙紝鍒囧洖 OpenAI 鍏煎寮曟搸鍚庝粛鍙户缁娇鐢ㄣ€?/span>
                    </Alert>
                </div>
            ) : (
                <div className="flex flex-col gap-2">
                    <p className="settings-menu-section-title">Character References</p>
                    <div className="menu-group">
                        {characters.length === 0 ? (
                            <div className="ui-empty py-8">
                                <Camera size={22} />
                                <span className="menu-desc">鏆傛棤瑙掕壊銆?/span>
                            </div>
                        ) : characters.map(character => {
                            const preview = referencePreviews[character.id];
                            return (
                                <div key={character.id} className="menu-item">
                                <span className="h-11 w-11 shrink-0 overflow-hidden rounded-xl bg-[var(--c-input)]">
                                    {preview ? (
                                        <img src={preview} alt="" className="h-full w-full object-cover" />
                                    ) : character.avatar ? (
                                        <img src={character.avatar} alt="" className="h-full w-full object-cover" />
                                    ) : (
                                        <span className="flex h-full w-full items-center justify-center ts-13 font-semibold text-[var(--c-icon)]">
                                            {character.name.slice(0, 1)}
                                        </span>
                                    )}
                                </span>
                                <span className="min-w-0 flex flex-1 flex-col">
                                    <span className="menu-label truncate">{character.name}</span>
                                    <span className="menu-desc truncate">{preview ? "宸蹭笂浼犲弬鑰冨浘" : "鏈笂浼犲弬鑰冨浘"}</span>
                                </span>
                                <span className="menu-right flex gap-2">
                                    <button
                                        type="button"
                                        className="ui-link-btn"
                                        aria-label={`涓婁紶 ${character.name} 鐨勫弬鑰冨浘`}
                                        onClick={() => {
                                            const input = document.createElement("input");
                                            input.type = "file";
                                            input.accept = "image/*";
                                            input.onchange = async () => {
                                                const file = input.files?.[0];
                                                if (file) await uploadReference(character.id, file);
                                            };
                                            input.click();
                                        }}
                                    >
                                        <Upload size={18} />
                                    </button>
                                    {preview && (
                                        <button
                                            type="button"
                                            className="ui-link-btn"
                                            data-variant="danger"
                                            aria-label={`鍒犻櫎 ${character.name} 鐨勫弬鑰冨浘`}
                                            onClick={() => removeReference(character.id)}
                                        >
                                            <Trash2 size={18} />
                                        </button>
                                    )}
                                </span>
                                </div>
                            );
                        })}
                    </div>
                </div>
            )}

            {pendingDeletePresetId && (
                <ConfirmDialog
                    title="纭鍒犻櫎棰勮锛?
                    message={`棰勮鈥?{naiSettings.presets.find(p => p.id === pendingDeletePresetId)?.name || "鏈懡鍚嶉璁?}鈥濆垹闄ゅ悗鏃犳硶鎭㈠銆俙}
                    icon={Trash2}
                    variant="danger"
                    confirmLabel="纭鍒犻櫎"
                    cancelLabel="鍙栨秷"
                    onConfirm={() => {
                        deletePreset(pendingDeletePresetId);
                        setPendingDeletePresetId(null);
                    }}
                    onCancel={() => setPendingDeletePresetId(null)}
                />
            )}

        </div>
    );
}
