"use strict";
const fs = require("fs");
const path = require("path");
const os = require("os");
const { exec } = require("child_process");

const USER_HOME = os.homedir();

function slugify(text) {
    return text
        .toString()
        .toLowerCase()
        .trim()
        .replace(/[\s\W-]+/g, "-")
        .replace(/^-+|-+$/g, "");
}

class SkillWorkshop {
    createSkill({ name, description, type, isGlobal, workspacePath, instructions }) {
        try {
            if (!name || !name.trim()) {
                return { success: false, error: "Название скилла обязательно" };
            }

            const slug = slugify(name);
            const baseDir = isGlobal || !workspacePath 
                ? path.join(USER_HOME, ".gemini", "config", "skills")
                : path.join(workspacePath, ".gemini", "skills");

            const targetDir = path.join(baseDir, slug);
            if (fs.existsSync(targetDir)) {
                return { success: false, error: `Скилл с именем "${slug}" уже существует` };
            }

            fs.mkdirSync(targetDir, { recursive: true });

            const mdContent = `---
name: ${slug}
description: ${description ? description.replace(/\r?\n/g, " ") : name}
---

# ${name}

## Описание
${description || name}

## Инструкции для агента
${instructions || "Опишите пошаговый порядок действий для агента при активации этого скилла."}
`;

            fs.writeFileSync(path.join(targetDir, "SKILL.md"), mdContent, "utf8");

            if (type === "script") {
                const scriptsDir = path.join(targetDir, "scripts");
                fs.mkdirSync(scriptsDir, { recursive: true });
                const sampleScript = `#!/usr/bin/env python3
# Вспомогательный скрипт для скилла ${slug}
import sys

def main():
    print("Выполнение скрипта скилла ${slug}")

if __name__ == "__main__":
    main()
`;
                fs.writeFileSync(path.join(scriptsDir, "run.py"), sampleScript, "utf8");
            }

            return {
                success: true,
                slug,
                path: targetDir
            };
        } catch (e) {
            return { success: false, error: e.message };
        }
    }

    importSkill({ source, isGlobal, workspacePath }) {
        return new Promise((resolve) => {
            if (!source || !source.trim()) {
                return resolve({ success: false, error: "Укажите путь или URL" });
            }

            const trimmed = source.trim();
            const baseDir = isGlobal || !workspacePath 
                ? path.join(USER_HOME, ".gemini", "config", "skills")
                : path.join(workspacePath, ".gemini", "skills");

            // Check if local directory
            if (fs.existsSync(trimmed)) {
                try {
                    const skillName = path.basename(trimmed);
                    const dest = path.join(baseDir, skillName);
                    fs.cpSync(trimmed, dest, { recursive: true });
                    return resolve({ success: true, path: dest, name: skillName });
                } catch (e) {
                    return resolve({ success: false, error: e.message });
                }
            }

            // Git URL import
            if (trimmed.startsWith("http://") || trimmed.startsWith("https://") || trimmed.startsWith("git@")) {
                const repoName = path.basename(trimmed, ".git");
                const dest = path.join(baseDir, repoName);
                if (fs.existsSync(dest)) {
                    return resolve({ success: false, error: `Директория ${repoName} уже существует` });
                }

                exec(`git clone --depth 1 "${trimmed}" "${dest}"`, (err) => {
                    if (err) {
                        return resolve({ success: false, error: `Ошибка клонирования git: ${err.message}` });
                    }
                    resolve({ success: true, path: dest, name: repoName });
                });
                return;
            }

            resolve({ success: false, error: "Неверный путь или URL" });
        });
    }
}

const skillWorkshop = new SkillWorkshop();

module.exports = {
    skillWorkshop
};
