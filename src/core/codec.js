/* Browser + Node compatible encoder. See docs/provenance.md and NOTICE for protocol / artwork rights. */
(function (root) {
  'use strict';
  const TABLE = root.SunflowerProtocol;
  const ALPHA = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ $%*+-./:';
  const URL_ALPHA =
    "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ!#$&'()*+,/:;=?@-._~";
  const PROFILES = {
    L: {
      bits: 1,
      sizes: [
        [28, 10, 1],
        [38, 14, 1],
        [46, 20, 1],
      ],
    },
    M: {
      bits: 0,
      sizes: [
        [25, 13, 1],
        [35, 17, 1],
        [43, 23, 1],
      ],
    },
    Q: {
      bits: 3,
      sizes: [
        [20, 18, 1],
        [26, 13, 2],
        [34, 16, 2],
      ],
    },
    H: {
      bits: 2,
      sizes: [
        [14, 24, 1],
        [20, 16, 2],
        [24, 21, 2],
      ],
    },
  };
  const exp = new Uint8Array(512),
    log = new Uint8Array(256);
  for (let i = 0, x = 1; i < 255; i++) {
    exp[i] = x;
    log[x] = i;
    x <<= 1;
    if (x & 256) x ^= 0x11d;
  }
  for (let i = 255; i < 512; i++) exp[i] = exp[i - 255];
  const multiply = (a, b) => (a && b ? exp[log[a] + log[b]] : 0);

  // The reference protocol uses a streaming radix conversion, not a BigInt conversion.
  function packRadix(text, alphabet) {
    let value = 0,
      leading = 0,
      started = false;
    const bytes = [];
    for (const char of text) {
      const digit = alphabet.indexOf(char);
      if (digit < 0) throw new Error('内容包含不支持的字符。');
      if (!started && digit === 0) {
        leading++;
        continue;
      }
      started = true;
      value = value * alphabet.length + digit;
      while (value >= 256) {
        bytes.push(value & 255);
        value = Math.floor(value / 256);
      }
    }
    if (value) bytes.push(value);
    if (leading > 255) throw new Error('链接过长。');
    return Uint8Array.from([...bytes, leading].reverse());
  }
  function unpackRadix(bytes, alphabet) {
    let value = 0;
    const digits = [];
    for (const byte of bytes.slice(1)) {
      value = value * 256 + byte;
      while (value >= alphabet.length) {
        digits.push(value % alphabet.length);
        value = Math.floor(value / alphabet.length);
      }
    }
    if (value) digits.push(value);
    digits.push(...Array(bytes[0]).fill(0));
    return digits
      .reverse()
      .map((digit) => alphabet[digit])
      .join('');
  }
  function payloadBits(text) {
    const compact = [...text].every((char) => URL_ALPHA.includes(char));
    const value = compact
      ? unpackRadix(packRadix(text, URL_ALPHA), ALPHA)
      : new TextEncoder().encode(text);
    const bits = [];
    const push = (n, count) => {
      for (let i = count - 1; i >= 0; i--) bits.push((n >>> i) & 1);
    };
    push(compact ? 2 : 4, 4);
    push(value.length, compact ? 9 : 8);
    if (compact) {
      for (let i = 0; i < value.length; i += 2) {
        const first = ALPHA.indexOf(value[i]);
        if (i + 1 < value.length) push(first * 45 + ALPHA.indexOf(value[i + 1]), 11);
        else push(first, 6);
      }
    } else for (const byte of value) push(byte, 8);
    return bits;
  }
  function parityBytes(data, count) {
    let generator = [1];
    for (let i = 0; i < count; i++) {
      const next = Array(generator.length + 1).fill(0);
      generator.forEach((value, j) => {
        next[j] ^= value;
        next[j + 1] ^= multiply(value, exp[i]);
      });
      generator = next;
    }
    const result = [...data, ...Array(count).fill(0)];
    for (let i = 0; i < data.length; i++) {
      const factor = result[i];
      for (let j = 1; j < generator.length; j++) result[i + j] ^= multiply(generator[j], factor);
    }
    return [...data, ...result.slice(data.length)];
  }
  function positions(version) {
    const cells = [];
    TABLE.data[version].forEach((flags, ray) => {
      for (let ring = 0; ring < 16; ring++) if ((flags >>> ring) & 1) cells.push([ray, ring]);
    });
    return cells;
  }
  function makeMatrix(words, version, level, mask) {
    const matrix = Array.from({ length: 72 }, () => Array(16).fill(null));
    positions(version).forEach(([ray, ring], index) => {
      matrix[ray][ring] =
        ((words[index >>> 3] >>> (7 - (index % 8))) & 1) ^ ((TABLE.masks[mask][ray] >>> ring) & 1);
    });
    const format = TABLE.formats[(version * 4 + PROFILES[level].bits) * 32 + mask];
    for (let ray = 1; ray < 72; ray += 2)
      matrix[ray][6] = (format >>> (17 - (((ray - 1) / 2) % 18))) & 1;
    for (let ray = 0; ray < 72; ray++) {
      if ((version === 0 && ray % 2 === 0) || (version === 1 && ray % 4 === 0)) continue;
      const first = matrix[ray].findIndex((value, ring) => ring >= 3 && value !== null);
      if (first >= 3)
        for (let ring = 3; ring < first; ring++) matrix[ray][ring] = matrix[ray][first];
      if (matrix[ray][14] !== null) matrix[ray][15] = matrix[ray][14];
    }
    return matrix;
  }
  function score(matrix) {
    let dark = 0,
      total = 0,
      joins = 0,
      long = 0;
    for (const ray of matrix) {
      let run = 0;
      for (const value of ray) {
        if (value !== null) {
          dark += value;
          total++;
        }
        run = value === 1 ? run + 1 : 0;
        if (run > 1) joins++;
        if (run > 7) long++;
      }
    }
    return joins - long * 4 - Math.abs(dark / total - 0.5) * 150;
  }
  class CapacityError extends Error {
    constructor(message) {
      super(message);
      this.name = 'CapacityError';
    }
  }
  function validateUrl(input) {
    const text = input.trim();
    if (!text) throw new Error('请先输入网页链接。');
    if (!/^https?:\/\//i.test(text)) throw new Error('链接需要以 https:// 或 http:// 开头。');
    if (/[\s\x00-\x1f\x7f]/.test(text)) throw new Error('链接不能包含空格、换行或控制字符。');
    let url;
    try {
      url = new URL(text);
    } catch {
      throw new Error('链接格式不正确，请检查域名和地址。');
    }
    if (!url.hostname) throw new Error('链接缺少域名。');
    if (text.length > 5000) throw new Error('链接过长，最多支持 5000 个字符。');
    return text;
  }
  function encode(input, { version = 'auto', level = 'auto' } = {}) {
    const text = validateUrl(input);
    const versions = version === 'auto' ? [0, 1, 2] : [Number(version)];
    const levels = level === 'auto' ? ['H', 'Q', 'M', 'L'] : [level];
    if (
      versions.some((v) => !Number.isInteger(v) || v < 0 || v > 2) ||
      levels.some((l) => !Object.hasOwn(PROFILES, l))
    )
      throw new Error('编码设置无效。');
    if (text.length > 512) throw new CapacityError('链接超出葵花码容量。');
    const bits = payloadBits(text);
    let chosen;
    for (const v of versions) {
      for (const l of levels)
        if (bits.length <= PROFILES[l].sizes[v][0] * 8) {
          chosen = { version: v, level: l };
          break;
        }
      if (chosen) break;
    }
    if (!chosen) {
      if (![...text].every((char) => URL_ALPHA.includes(char))) {
        const bytes = new TextEncoder().encode(text).length;
        const maxBytes =
          Math.max(...versions.flatMap((v) => levels.map((l) => PROFILES[l].sizes[v][0]))) - 2;
        throw new CapacityError(
          `链接超出容量：UTF-8 编码为 ${bytes} 字节，当前设置最多 ${maxBytes} 字节。请缩短链接或调整设置。`,
        );
      }
      throw new CapacityError('链接超出当前容量，请增加射线、降低纠错等级，或缩短链接。');
    }
    const [capacity, parity, blocks] = PROFILES[chosen.level].sizes[chosen.version];
    const bitLength = bits.length;
    bits.push(...Array(Math.min(4, capacity * 8 - bits.length)).fill(0));
    while (bits.length % 8) bits.push(0);
    const data = [];
    for (let i = 0; i < bits.length; i += 8)
      data.push(bits.slice(i, i + 8).reduce((n, bit) => n * 2 + bit, 0));
    for (let pad = 0; data.length < capacity; pad++) data.push(pad % 2 ? 17 : 236);
    const perBlock = capacity / blocks;
    const encodedBlocks = Array.from({ length: blocks }, (_, i) =>
      parityBytes(data.slice(i * perBlock, (i + 1) * perBlock), parity),
    );
    const words = [];
    for (let i = 0; i < perBlock + parity; i++)
      for (const block of encodedBlocks) words.push(block[i]);
    let best;
    for (let mask = 0; mask < 32; mask++) {
      const matrix = makeMatrix(words, chosen.version, chosen.level, mask),
        value = score(matrix);
      if (!best || value > best.score) best = { matrix, mask, score: value };
    }
    const result = { ...chosen, ...best, text, bitLength, capacity, codeword: words };
    if (decode(result.matrix, result.version) !== text)
      throw new Error('编码回读校验失败，请尝试调整链接。');
    return result;
  }
  // Validates an undamaged matrix. It is not an image scanner or a damage-repair decoder.
  function decode(matrix, version) {
    let format = 0;
    for (let ray = 1; ray < 36; ray += 2) format = format * 2 + matrix[ray][6];
    const index = TABLE.formats.indexOf(format);
    if (index < 0 || Math.floor(index / 128) !== version) throw new Error('格式校验失败。');
    const mask = index % 32,
      levelBits = Math.floor(index / 32) % 4;
    const level = Object.keys(PROFILES).find((l) => PROFILES[l].bits === levelBits);
    const cells = positions(version),
      words = new Uint8Array(cells.length / 8);
    cells.forEach(([ray, ring], i) => {
      words[i >>> 3] |=
        (matrix[ray][ring] ^ ((TABLE.masks[mask][ray] >>> ring) & 1)) << (7 - (i % 8));
    });
    const [capacity, parity, blockCount] = PROFILES[level].sizes[version],
      perBlock = capacity / blockCount;
    const data = [];
    for (let block = 0; block < blockCount; block++) {
      const bytes = Array.from(
        { length: perBlock + parity },
        (_, i) => words[i * blockCount + block],
      );
      for (let i = 0; i < parity; i++) {
        const syndrome = bytes.reduce((sum, byte) => multiply(sum, exp[i]) ^ byte, 0);
        if (syndrome) throw new Error('数据纠错校验失败。');
      }
      data.push(...bytes.slice(0, perBlock));
    }
    let cursor = 0;
    const read = (count) => {
      if (cursor + count > data.length * 8) throw new Error('载荷不完整。');
      let value = 0;
      for (let i = 0; i < count; i++, cursor++)
        value = value * 2 + ((data[cursor >>> 3] >>> (7 - (cursor % 8))) & 1);
      return value;
    };
    const mode = read(4),
      length = read(mode === 2 ? 9 : 8);
    if (mode === 4)
      return new TextDecoder('utf-8', { fatal: true }).decode(
        Uint8Array.from({ length }, () => read(8)),
      );
    if (mode !== 2) throw new Error('不支持的载荷格式。');
    let value = '';
    for (let i = 0; i < length; i += 2) {
      const pair = i + 1 < length,
        n = read(pair ? 11 : 6);
      if (n >= (pair ? 2025 : 45)) throw new Error('载荷无效。');
      value += pair ? ALPHA[Math.floor(n / 45)] + ALPHA[n % 45] : ALPHA[n];
    }
    return unpackRadix(packRadix(value, ALPHA), URL_ALPHA);
  }
  const escapeXml = (text) =>
    text.replace(
      /[&<>"']/g,
      (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c],
    );
  function renderSvg(code, { size = 1024, avatar = '' } = {}) {
    if (![512, 1024, 2048].includes(Number(size))) throw new Error('图片尺寸无效。');
    if (avatar && !/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(avatar))
      throw new Error('头像格式无效。');
    const point = (ray, ring) => {
      const angle = ((180 + ray * 5) * Math.PI) / 180,
        radius = 250 + ((ring - 3) * 1000) / 54;
      return [
        (500 + radius * Math.cos(angle)).toFixed(3),
        (500 + radius * Math.sin(angle)).toFixed(3),
      ];
    };
    const shapes = [];
    for (let ray = 0; ray < 72; ray++) {
      let start = -1;
      for (let ring = 3; ring <= 16; ring++) {
        const on = ring < 16 && code.matrix[ray][ring] === 1;
        if (on && start < 0) start = ring;
        if (!on && start >= 0) {
          const a = point(ray, start),
            b = point(ray, ring - 1);
          shapes.push(
            start === ring - 1
              ? `<circle cx="${a[0]}" cy="${a[1]}" r="9" stroke="none"/>`
              : `<path d="M${a.join(' ')}L${b.join(' ')}"/>`,
          );
          start = -1;
        }
      }
    }
    const finders = [
      [204, 204],
      [796, 204],
      [204, 796],
    ]
      .map(
        ([x, y]) =>
          `<circle cx="${x}" cy="${y}" r="47" fill="#080908"/><circle cx="${x}" cy="${y}" r="32" fill="white"/><circle cx="${x}" cy="${y}" r="9" fill="#080908"/>`,
      )
      .join('');
    const symbol = (x, y, scale = 1) =>
      `<g transform="translate(${x} ${y}) scale(${scale})" fill="none" stroke="white" stroke-width="16" stroke-linecap="round" stroke-linejoin="round"><path d="M30-2C48-7 54-20 48-33C42-47 24-51 12-43C4-38 0-31 0-22V22C0 31-4 38-12 43C-24 51-42 47-48 33C-54 20-48 7-30 2"/></g>`;
    const center = avatar
      ? `<defs><clipPath id="avatar-clip"><circle cx="500" cy="500" r="224"/></clipPath></defs><image x="276" y="276" width="448" height="448" preserveAspectRatio="xMidYMid slice" clip-path="url(#avatar-clip)" href="${escapeXml(avatar)}"/>`
      : `<g aria-label="微信小程序"><circle cx="500" cy="500" r="224" fill="#444444"/>${symbol(500, 500, 2.2)}</g>`;
    const badge = `<circle cx="800" cy="800" r="100" fill="#2eac4b"/>${symbol(800, 800)}`;
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 1000 1000" role="img" aria-label="葵花码"><title>葵花码</title><rect width="1000" height="1000" fill="white"/><g fill="#080908" stroke="#080908" stroke-width="18" stroke-linecap="round">${shapes.join('')}</g>${finders}${center}${badge}</svg>`;
  }
  root.SunflowerCode = {
    encode,
    decode,
    renderSvg,
    validateUrl,
    profiles: PROFILES,
    CapacityError,
  };
})(globalThis);
