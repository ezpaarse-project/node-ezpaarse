const fs = require('fs-extra');
const path = require('path');

/**
 * Coerce header options into a header object
 * @param args options parsed by yargs
 */
function coerceHeaders(args) {
  const headerList = Array.isArray(args) ? args : [args];
  const headers = {};

  headerList.forEach((header) => {
    const i = header.indexOf(':');
    if (i !== -1) {
      headers[header.substr(0, i).trim().toLowerCase()] = header.substr(i + 1).trim();
    } else {
      throw new Error(`Wrong header syntax: "${header}"`);
    }
  });

  return headers;
}

/**
 * Coerce download options into an array
 * @param args options parsed by yargs
 */
function coerceDownloads(args) {
  const downloadList = Array.isArray(args) ? args : [args];

  return downloadList.map((download) => {
    if (typeof download !== 'string') {
      throw new Error('download parameter should be a string');
    }
    const [filename, dest] = download.split(':');
    return { filename, dest };
  });
}

/**
 * Find files into a directory
 * @param {string} dir the directory to search
 * @param {boolean} recursive whether or not to search recursively
 */
async function findInDir(dir, recursive) {
  let files = [];

  const fileList = await Promise.all(
    (await fs.readdir(dir)).map(async (f) => ({
      name: f,
      path: path.resolve(dir, f),
      stat: await fs.stat(path.resolve(dir, f)),
    })),
  );

  files = files.concat(fileList.filter((f) => f.stat.isFile()));

  if (recursive) {
    const dirs = fileList
      .filter((f) => f.stat.isDirectory())
      .map((f) => f.path);
    const subdirs = await Promise.all(dirs.map((d) => findInDir(d, recursive)));

    subdirs.forEach((subfiles) => {
      files = files.concat(subfiles);
    });
  }

  return files;
}

/**
 * Check that a path is a directory
 * @param {string} dir the path to check
 */
async function isDir(dir, opt = {}) {
  const { ignoreNotFound = false } = opt;

  try {
    return (await fs.stat(dir)).isDirectory();
  } catch (e) {
    return e.code === 'ENOENT' ? !!ignoreNotFound : Promise.reject(e);
  }
}

module.exports = {
  coerceHeaders,
  coerceDownloads,
  findInDir,
  isDir,
};
