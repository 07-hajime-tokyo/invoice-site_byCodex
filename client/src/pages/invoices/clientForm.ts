/** A fresh form for each existing reset point; invisible notes remain in the payload. */
export function createEmptyClientForm() {
  return { name: "", company: "", email: "", phone: "", address: "", city: "", country: "", notes: "", extraInfo: "" };
}
