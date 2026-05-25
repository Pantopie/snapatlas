// nanoid — tiny, secure, URL-friendly unique ID generator
// Inlined from https://github.com/ai/nanoid (MIT)
const nanoid = (size = 21) => {
  let id = "";
  const bytes = crypto.getRandomValues(new Uint8Array((size |= 0)));
  const alphabet = "useandom-26T198340PX75pxJACKVERYMINDBUSHWOLF_GQZbfghjklqvwyzrict";
  while (size--) id += alphabet[bytes[size] & 63];
  return id;
};
