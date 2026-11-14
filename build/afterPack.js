// Runs after electron-builder packs the app. Stamps our icon and product name
// into the main .exe so Start Menu / desktop shortcuts, Task Manager and
// Windows Search show "AV Control Utility" with the right icon.
// Pure JS (resedit), so it works when building from Linux/macOS without Wine.
const fs = require('fs');
const path = require('path');

exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== 'win32') return;

  const ResEdit = await import('resedit');
  const productName = context.packager.appInfo.productName;
  const exePath = path.join(context.appOutDir, `${productName}.exe`);
  const icoPath = path.join(context.packager.projectDir, 'build', 'icon.ico');

  const exe = ResEdit.NtExecutable.from(fs.readFileSync(exePath));
  const res = ResEdit.NtExecutableResource.from(exe);

  // --- icon: replace every existing icon group with ours ---
  const iconFile = ResEdit.Data.IconFile.from(fs.readFileSync(icoPath));
  const groups = ResEdit.Resource.IconGroupEntry.fromEntries(res.entries);
  const targets = groups.length ? groups : [{ id: 1, lang: 1033 }];
  targets.forEach((g) => {
    ResEdit.Resource.IconGroupEntry.replaceIconsForResource(
      res.entries,
      g.id,
      g.lang,
      iconFile.icons.map((i) => i.data),
    );
  });

  // --- version info: what Task Manager / Properties show ---
  const version = context.packager.appInfo.version;
  const infos = ResEdit.Resource.VersionInfo.fromEntries(res.entries);
  const info = infos[0] || ResEdit.Resource.VersionInfo.createEmpty();
  const lang = info.lang || 1033;
  const [major, minor, patch] = version.split('.').map((n) => parseInt(n, 10) || 0);
  info.setFileVersion(major, minor, patch, 0, lang);
  info.setProductVersion(major, minor, patch, 0, lang);
  info.setStringValues(
    { lang, codepage: 1200 },
    {
      ProductName: productName,
      FileDescription: productName,
      InternalName: productName,
      OriginalFilename: `${productName}.exe`,
      CompanyName: productName,
      LegalCopyright: productName,
    },
  );
  info.outputToResourceEntries(res.entries);

  res.outputResource(exe);
  fs.writeFileSync(exePath, Buffer.from(exe.generate()));
  // eslint-disable-next-line no-console
  console.log(`  \u2022 afterPack      stamped icon + name into ${path.basename(exePath)}`);
};
