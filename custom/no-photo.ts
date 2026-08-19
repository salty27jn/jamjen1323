// custom/no-photo.ts
// 「禁止角色发照片」本地增强。
// 通过 apply-custom.mjs 注入到 rich-message-parser / moments-engine / image-generation-settings，
// 同步作者更新后会自动重放，不会被覆盖。
// 作用：聊天（私聊/群聊/微信/主动消息/编辑重解析）与朋友圈中，角色输出的 [照片] 标签
// 及其图片描述文字不再落库/不再显示，只保留纯文字。
import { kvGet, kvSet } from "@/lib/kv-db";

const NO_PHOTO_KEY = "ai_phone_no_photo_v1";

export function isNoPhotoEnabled(): boolean {
    return kvGet(NO_PHOTO_KEY) === "true";
}

export function setNoPhotoEnabled(value: boolean): void {
    kvSet(NO_PHOTO_KEY, value ? "true" : "false");
}

/** 聊天解析用：开启时丢弃 image 类型的 part（照片标签不落库、不显示）。 */
export function noPhotoFilter(p: { mediaType?: string }): boolean {
    if (p.mediaType === "image" && isNoPhotoEnabled()) return false;
    return true;
}

/** 朋友圈用：开启时返回 true，发帖解析剥离照片标签（只保留纯文字）。 */
export function shouldStripMomentPhoto(): boolean {
    return isNoPhotoEnabled();
}
