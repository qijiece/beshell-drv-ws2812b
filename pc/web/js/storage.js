// 本地项目管理：localStorage 持久化。
// 每条记录 = 元数据（名称/说明/更新时间）+ 完整引擎配置（toEngineConfig 输出，
// 已含 pin 等驱动设置 strip.{pin,length,loop} 与 fps/repeat/repeatCount/分段/关键帧/帧动作等动画设置）。
const KEY = 'beshell.ws2812b.projects';

function readAll() {
    try { return JSON.parse(localStorage.getItem(KEY)) || []; }
    catch (e) { return []; }
}
function writeAll(list) {
    localStorage.setItem(KEY, JSON.stringify(list));
}

// 列表元数据（不含 config，供列表 UI 轻量展示）
export function listProjects() {
    return readAll().map(r => ({ id: r.id, name: r.name, description: r.description, updatedAt: r.updatedAt }));
}

// 保存：id 存在则覆盖更新，否则新建；返回项目 id
export function saveProject(config, layout, { id, name, description }) {
    const list = readAll();
    const now = Date.now();
    if (id) {
        const rec = list.find(r => r.id === id);
        if (rec) {
            rec.name = name;
            rec.description = description;
            rec.config = config;
            rec.layout = layout;
            rec.updatedAt = now;
            writeAll(list);
            return id;
        }
    }
    const nid = 'p' + Math.random().toString(36).slice(2, 10);
    list.push({ id: nid, name, description, config, layout, updatedAt: now, createdAt: now });
    writeAll(list);
    return nid;
}

// 载入：返回该项目的完整引擎配置，不存在返回 null
export function loadProject(id) {
    const rec = readAll().find(r => r.id === id);
    return rec ? { config: rec.config, layout: rec.layout } : null;
}

export function deleteProject(id) {
    writeAll(readAll().filter(r => r.id !== id));
}

// 仅更新配置与灯带设置（保留名称/说明），供一键保存覆盖；返回是否命中
export function updateProjectConfig(id, config, layout) {
    const list = readAll();
    const rec = list.find(r => r.id === id);
    if (!rec) return false;
    rec.config = config;
    rec.layout = layout;
    rec.updatedAt = Date.now();
    writeAll(list);
    return true;
}
