const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// Icon dimensions for each density
const iconSizes = {
  'mdpi': 48,
  'hdpi': 72,
  'xhdpi': 96,
  'xxhdpi': 144,
  'xxxhdpi': 192,
};

const resDir = path.join(__dirname, 'android', 'app', 'src', 'main', 'res');

console.log('Starting icon resize process...\n');

// Backup original icons
const backupDir = path.join(__dirname, 'android', 'app', 'src', 'main', 'res-backup');
if (!fs.existsSync(backupDir)) {
  console.log('Creating backup of original icons...');
  execSync(`xcopy /E /I /Y "${resDir}" "${backupDir}"`, { stdio: 'inherit' });
  console.log('Backup created at:', backupDir, '\n');
}

// Try to install sharp if not available
try {
  require.resolve('sharp');
} catch (e) {
  console.log('Installing sharp package for image processing...');
  try {
    execSync('npm install --no-save sharp', { cwd: __dirname, stdio: 'inherit' });
  } catch (err) {
    console.error('\nFailed to install sharp. Please install it manually:');
    console.error('npm install sharp\n');
    process.exit(1);
  }
}

const sharp = require('sharp');

async function resizeIcons() {
  for (const [density, size] of Object.entries(iconSizes)) {
    const densityDir = path.join(resDir, `mipmap-${density}`);

    // Resize regular icon
    const iconPath = path.join(densityDir, 'ic_launcher.png');
    const roundIconPath = path.join(densityDir, 'ic_launcher_round.png');

    console.log(`Resizing icons for ${density} (${size}x${size})...`);

    if (fs.existsSync(iconPath)) {
      await sharp(iconPath)
        .resize(size, size, { fit: 'cover' })
        .png({ compressionLevel: 9 })
        .toFile(iconPath + '.tmp');

      fs.renameSync(iconPath + '.tmp', iconPath);
      console.log('  ✓ ic_launcher.png resized');
    }

    if (fs.existsSync(roundIconPath)) {
      await sharp(roundIconPath)
        .resize(size, size, { fit: 'cover' })
        .png({ compressionLevel: 9 })
        .toFile(roundIconPath + '.tmp');

      fs.renameSync(roundIconPath + '.tmp', roundIconPath);
      console.log('  ✓ ic_launcher_round.png resized');
    }
  }

  console.log('\n✅ All icons resized successfully!');
  console.log('\nNew icon sizes:');

  // Show new file sizes
  for (const density of Object.keys(iconSizes)) {
    const iconPath = path.join(resDir, `mipmap-${density}`, 'ic_launcher.png');
    if (fs.existsSync(iconPath)) {
      const stats = fs.statSync(iconPath);
      const sizeKB = (stats.size / 1024).toFixed(2);
      console.log(`  ${density}: ${sizeKB} KB`);
    }
  }
}

resizeIcons().catch(err => {
  console.error('Error resizing icons:', err);
  process.exit(1);
});
