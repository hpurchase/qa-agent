import * as cheerio from "cheerio";

export type SimplifiedElement = {
  tag: string;
  type?: string;
  name?: string;
  placeholder?: string;
  label?: string;
  text?: string;
  href?: string;
  role?: string;
  required?: boolean;
  checked?: boolean;
  disabled?: boolean;
  options?: string[];
};

/**
 * Strips a full HTML document down to only visible interactive elements
 * (inputs, buttons, selects, checkboxes, links) with their labels.
 * Returns a compact JSON-serializable array (~500-1000 tokens).
 */
export function simplifyDom(html: string): SimplifiedElement[] {
  const $ = cheerio.load(html);
  const elements: SimplifiedElement[] = [];

  // Remove hidden/invisible elements (but keep error messages even if they look hidden).
  $("[hidden], [style*='display:none'], [style*='display: none']").not("[class*='error'], [class*='alert'], [role='alert']").remove();
  $("[aria-hidden='true']").not("[class*='error'], [class*='alert'], [role='alert']").remove();

  // Headings (give Claude page context).
  $("h1, h2, h3").each((_, el) => {
    const text = $(el).text().replace(/\s+/g, " ").trim();
    if (text && text.length < 200) {
      elements.push({ tag: el.tagName.toLowerCase(), text });
    }
  });

  // Paragraphs that look instructional (short, near forms).
  $("p").each((_, el) => {
    const text = $(el).text().replace(/\s+/g, " ").trim();
    if (text.length > 10 && text.length < 150) {
      elements.push({ tag: "p", text });
    }
  });

  // Inputs.
  $("input").each((_, el) => {
    const $el = $(el);
    const type = ($el.attr("type") ?? "text").toLowerCase();
    if (type === "hidden" || type === "submit") return;

    const name = $el.attr("name") ?? undefined;
    const placeholder = $el.attr("placeholder") ?? undefined;
    const ariaLabel = $el.attr("aria-label") ?? undefined;

    let label: string | undefined;
    const id = $el.attr("id");
    if (id) {
      const $label = $(`label[for="${id}"]`);
      if ($label.length) label = $label.text().replace(/\s+/g, " ").trim();
    }
    if (!label) {
      const $parent = $el.closest("label");
      if ($parent.length) label = $parent.text().replace(/\s+/g, " ").trim();
    }
    if (!label && ariaLabel) label = ariaLabel;

    elements.push({
      tag: "input",
      type,
      name,
      placeholder,
      label,
      required: $el.attr("required") !== undefined || $el.attr("aria-required") === "true",
      checked: type === "checkbox" ? $el.is(":checked") : undefined,
      disabled: $el.attr("disabled") !== undefined || $el.attr("aria-disabled") === "true",
    });
  });

  // Textareas.
  $("textarea").each((_, el) => {
    const $el = $(el);
    const name = $el.attr("name") ?? undefined;
    const placeholder = $el.attr("placeholder") ?? undefined;
    let label: string | undefined;
    const id = $el.attr("id");
    if (id) {
      const $label = $(`label[for="${id}"]`);
      if ($label.length) label = $label.text().replace(/\s+/g, " ").trim();
    }
    elements.push({ tag: "textarea", name, placeholder, label });
  });

  // Selects.
  $("select").each((_, el) => {
    const $el = $(el);
    const name = $el.attr("name") ?? undefined;
    const options = $el
      .find("option")
      .map((_, o) => $(o).text().replace(/\s+/g, " ").trim())
      .get()
      .filter(Boolean)
      .slice(0, 20);

    let label: string | undefined;
    const id = $el.attr("id");
    if (id) {
      const $label = $(`label[for="${id}"]`);
      if ($label.length) label = $label.text().replace(/\s+/g, " ").trim();
    }
    elements.push({ tag: "select", name, label, options });
  });

  // Buttons and button-like elements.
  $("button, [role='button'], input[type='submit']").each((_, el) => {
    const $el = $(el);
    const text = $el.text().replace(/\s+/g, " ").trim() || $el.attr("value") || undefined;
    if (!text || text.length > 100) return;
    elements.push({
      tag: "button",
      text,
      type: ($el.attr("type") ?? "button").toLowerCase(),
    });
  });

  // Links that look actionable.
  $("a").each((_, el) => {
    const $el = $(el);
    const text = $el.text().replace(/\s+/g, " ").trim();
    const href = $el.attr("href") ?? "";
    if (!text || text.length > 100) return;
    if (href.startsWith("javascript:") || href === "#") return;
    const looksActionable =
      /sign|log|skip|next|continue|start|get started|later|not now|back|cancel/i.test(text) ||
      $el.attr("class")?.toLowerCase().includes("button");
    if (!looksActionable) return;
    elements.push({ tag: "a", text, href });
  });

  // Error messages / validation messages — critical for stuck detection.
  $("[class*='error'], [class*='invalid'], [class*='alert'], [role='alert'], [aria-invalid='true']").each((_, el) => {
    const $el = $(el);
    const text = $el.text().replace(/\s+/g, " ").trim();
    if (text && text.length > 3 && text.length < 300) {
      elements.push({ tag: "error", text });
    }
  });

  // Progress indicators (step 1 of 5, progress bar, etc.).
  $("[class*='step'], [class*='progress'], [aria-label*='step'], [aria-valuenow]").each((_, el) => {
    const $el = $(el);
    const text = $el.text().replace(/\s+/g, " ").trim();
    const ariaLabel = $el.attr("aria-label");
    const progressText = text || ariaLabel || "";
    if (progressText && progressText.length < 100) {
      elements.push({ tag: "progress", text: progressText });
    }
  });

  return elements.slice(0, 80);
}
