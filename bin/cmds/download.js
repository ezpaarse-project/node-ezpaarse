const fs = require('fs');
const path = require('path');
const ezpaarse = require('../..');
const { coerceDownloads } = require('../../lib/utils');
const logger = require('../../lib/logger')();

exports.command = 'download <id> <files..>';
exports.aliases = ['d'];
exports.desc = 'Download files from a job directory';

exports.builder = (yargs) => yargs
  .coerce('files', coerceDownloads);

exports.handler = async (argv) => {
  const client = ezpaarse.Client({
    host: argv.host,
    proxy: argv.proxy,
  });
  const job = client.createJob(null, { id: argv.id });
  const outputFile = argv.output ? path.resolve(argv.output) : null;

  let hasError = false;

  for (const fileDownload of argv.files) {
    const { filename } = fileDownload;
    let { dest } = fileDownload;

    if (dest) {
      dest = path.resolve(dest);
    } else if (outputFile) {
      dest = outputFile.replace(/(\.[a-z]{2,4})?$/i, `.${filename}`);
    } else {
      dest = path.resolve(filename);
    }

    logger.info(`Downloading ${filename} into ${dest}`);

    try {
      await downloadFile(job, filename, dest);
    } catch (e) {
      hasError = true;
      logger.error(`Failed to download ${filename} : ${e.message}`);
    }
  }

  process.exit(hasError ? 1 : 0);
};

/**
 * Download a file from the job directory to a given path
 * @param {Object} job the job to download the file
 * @param {string} filename the file to download
 * @param {string} dest the place to store the file to
 */
async function downloadFile(job, filename, dest) {
  if (!job.id) {
    return Promise.reject(new Error('Job has no ID'));
  }

  const response = await job.download(filename);

  return new Promise((resolve, reject) => {
    response.data
      .pipe(fs.createWriteStream(dest))
      .on('error', reject)
      .on('finish', resolve);
  });
}
