'use strict';

// EXACT messages from the spec.
const MESSAGES = {
  BLURRY: 'ছবিটা পরিষ্কার নয়। আলোতে, কাছে থেকে পুষ্টি-তালিকার ছবি আবার পাঠান।',
  NOT_A_LABEL: 'পুষ্টি-তালিকা খুঁজে পাইনি। প্যাকেটের পেছনের টেবিলের ছবি দিন।',
  SERVER_ERROR: 'এখন সমস্যা হচ্ছে, একটু পরে চেষ্টা করুন।',
};

const CODE_TO_MESSAGE = {
  NOT_A_LABEL: MESSAGES.NOT_A_LABEL,
  SANITY_FAILED: MESSAGES.BLURRY,
  BASIS_UNKNOWN: MESSAGES.BLURRY,
  NOT_AN_IMAGE: MESSAGES.BLURRY,
  EMPTY_IMAGE: MESSAGES.BLURRY,
  UNSUPPORTED_TYPE: MESSAGES.BLURRY,
  TOO_LARGE: MESSAGES.BLURRY,
  GEMINI_FAILED: MESSAGES.SERVER_ERROR,
  DOWNLOAD_FAILED: MESSAGES.SERVER_ERROR,
  DOWNLOAD_TIMEOUT: MESSAGES.SERVER_ERROR,
  BAD_MEDIA_URL: MESSAGES.SERVER_ERROR,
};

/** Unknown errors -> generic server message (never leak internals). */
function userMessageFor(err) {
  return (err && CODE_TO_MESSAGE[err.code]) || MESSAGES.SERVER_ERROR;
}

module.exports = { MESSAGES, userMessageFor };
