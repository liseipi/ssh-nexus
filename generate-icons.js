// generate-icons.js
const sharp = require('sharp');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const inputPng = path.join(__dirname, 'resources/logo.png');
const resourcesDir = path.join(__dirname, 'resources');

async function generateIcons() {
    console.log('🚀 开始生成 Electron 所需图标...');

    if (!fs.existsSync(resourcesDir)) {
        fs.mkdirSync(resourcesDir, { recursive: true });
    }

    // 1. 生成 Windows icon.ico（使用 png-to-ico）
    console.log('📦 生成 icon.ico (Windows)...');
    await generateIco();

    // 2. 生成 macOS icon.icns
    console.log('🍎 生成 icon.icns (macOS)...');
    await generateIcns();

    // 3. 生成 Linux icon.png
    console.log('🐧 生成 icon.png (Linux 512x512)...');
    await sharp(inputPng)
        .resize(512, 512)
        .png({ quality: 100, compressionLevel: 9 })
        .toFile(path.join(resourcesDir, 'icon.png'));

    console.log('\n✅ 全部生成完成！');
    console.log('   resources/icon.ico     ← Windows');
    console.log('   resources/icon.icns    ← macOS');
    console.log('   resources/icon.png     ← Linux');
}

// 生成 Windows .ico
async function generateIco() {
    try {
        const pngToIco = require('png-to-ico');
        const buffer = await pngToIco(inputPng);
        fs.writeFileSync(path.join(resourcesDir, 'icon.ico'), buffer);
        console.log('✅ icon.ico 生成成功');
    } catch (err) {
        console.log('⚠️  png-to-ico 生成失败，尝试备用方案...');
        // 备用方案：生成 256x256 png 作为临时 ico
        await sharp(inputPng)
            .resize(256, 256)
            .png()
            .toFile(path.join(resourcesDir, 'icon.ico.png'));
        console.log('   已生成 icon.ico.png，请手动转为 .ico 或后续安装 png-to-ico 后重试');
    }
}

// 生成 macOS .icns
async function generateIcns() {
    const iconsetDir = path.join(resourcesDir, 'icon.iconset');
    if (fs.existsSync(iconsetDir)) fs.rmSync(iconsetDir, { recursive: true, force: true });
    fs.mkdirSync(iconsetDir);

    const sizes = [16, 32, 64, 128, 256, 512, 1024];

    for (const size of sizes) {
        await sharp(inputPng)
            .resize(size, size)
            .png()
            .toFile(path.join(iconsetDir, `icon_${size}x${size}.png`));

        if (size <= 512) {
            await sharp(inputPng)
                .resize(size * 2, size * 2)
                .png()
                .toFile(path.join(iconsetDir, `icon_${size}x${size}@2x.png`));
        }
    }

    try {
        execSync(`iconutil -c "${iconsetDir}" -o "${path.join(resourcesDir, 'icon.icns')}"`, { stdio: 'inherit' });
        console.log('✅ icon.icns 生成成功');
    } catch (err) {
        console.log('⚠️  iconutil 执行失败（这是正常现象，如果你不是在 macOS 上）');
        console.log('   后续可在 macOS 上手动执行：');
        console.log(`   iconutil -c icns resources/icon.iconset`);
    }

    // fs.rmSync(iconsetDir, { recursive: true, force: true }); // 清理临时文件
}

generateIcons().catch(err => {
    console.error('❌ 脚本执行失败:', err.message);
});