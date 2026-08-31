(() => {
  "use strict";

  const MAX_TEXT = 20_000;
  const MAX_ELEMENTS = 100;
  const elementRefs = new WeakMap();
  const elementsByRef = new Map();
  let nextElementRef = 1;

  const elementRef = (element) => {
    if (!(element instanceof Element)) return null;
    const existing = elementRefs.get(element);
    if (existing) return existing;
    const ref = `e${nextElementRef++}`;
    elementRefs.set(element, ref);
    elementsByRef.set(ref, element);
    return ref;
  };

  const text = (element, limit = 240) =>
    String(element?.innerText || element?.textContent || "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, limit);

  const visible = (element) => {
    if (!(element instanceof Element)) return false;
    const rect = element.getBoundingClientRect();
    const style = window.getComputedStyle(element);
    return (
      rect.width > 0 &&
      rect.height > 0 &&
      style.display !== "none" &&
      style.visibility !== "hidden" &&
      Number(style.opacity || "1") > 0 &&
      rect.bottom >= 0 &&
      rect.right >= 0 &&
      rect.top <= window.innerHeight &&
      rect.left <= window.innerWidth
    );
  };

  const elementSelector = (element) => {
    if (!(element instanceof Element)) return "";
    if (element.id) return `#${CSS.escape(element.id)}`;
    const segments = [];
    let cursor = element;
    while (cursor && cursor.nodeType === Node.ELEMENT_NODE && segments.length < 6) {
      let segment = cursor.tagName.toLowerCase();
      const stableClasses = Array.from(cursor.classList || [])
        .filter((name) => name && name.length < 48 && !/\d{5,}/.test(name))
        .slice(0, 2);
      if (stableClasses.length) {
        segment += stableClasses.map((name) => `.${CSS.escape(name)}`).join("");
      }
      const parent = cursor.parentElement;
      if (parent) {
        const sameTag = Array.from(parent.children).filter(
          (child) => child.tagName === cursor.tagName,
        );
        if (sameTag.length > 1) {
          segment += `:nth-of-type(${sameTag.indexOf(cursor) + 1})`;
        }
      }
      segments.unshift(segment);
      cursor = parent;
      if (cursor?.id) {
        segments.unshift(`#${CSS.escape(cursor.id)}`);
        break;
      }
    }
    return segments.join(" > ");
  };

  const describeElement = (element, index = 0) => {
    const rect = element.getBoundingClientRect();
    return {
      index,
      ref: elementRef(element),
      tag: element.tagName.toLowerCase(),
      selector: elementSelector(element),
      id: element.id || null,
      role: element.getAttribute("role"),
      name:
        element.getAttribute("aria-label") ||
        element.getAttribute("name") ||
        element.getAttribute("title") ||
        null,
      type: element.getAttribute("type"),
      placeholder: element.getAttribute("placeholder"),
      text: text(element),
      value:
        element instanceof HTMLInputElement ||
        element instanceof HTMLTextAreaElement ||
        element instanceof HTMLSelectElement
          ? String(element.value).slice(0, 240)
          : null,
      href: element instanceof HTMLAnchorElement ? element.href : null,
      disabled: "disabled" in element ? Boolean(element.disabled) : false,
      visible: visible(element),
      rect: {
        x: Math.round(rect.x),
        y: Math.round(rect.y),
        width: Math.round(rect.width),
        height: Math.round(rect.height),
        pageX: Math.round(rect.x + window.scrollX),
        pageY: Math.round(rect.y + window.scrollY),
      },
    };
  };

  const requireElement = (input) => {
    const ref = typeof input?.ref === "string" ? input.ref.trim() : "";
    if (ref) {
      const referenced = elementsByRef.get(ref);
      if (!referenced || !referenced.isConnected) {
        elementsByRef.delete(ref);
        throw new Error(`Element reference is stale or missing: ${ref}. Take a new snapshot.`);
      }
      return referenced;
    }
    const selector = typeof input?.selector === "string" ? input.selector.trim() : "";
    if (!selector) throw new Error("An element ref or CSS selector is required");
    const element = document.querySelector(selector);
    if (!element) throw new Error(`Element not found: ${selector}`);
    return element;
  };

  const dispatchPointerSequence = (element, point) => {
    const options = {
      bubbles: true,
      cancelable: true,
      composed: true,
      view: window,
      clientX: point?.x,
      clientY: point?.y,
    };
    element.dispatchEvent(new PointerEvent("pointerover", options));
    element.dispatchEvent(new MouseEvent("mouseover", options));
    element.dispatchEvent(new PointerEvent("pointerdown", options));
    element.dispatchEvent(new MouseEvent("mousedown", options));
    element.dispatchEvent(new PointerEvent("pointerup", options));
    element.dispatchEvent(new MouseEvent("mouseup", options));
    element.click();
  };

  const click = (input) => {
    const point =
      Number.isFinite(input?.x) && Number.isFinite(input?.y)
        ? { x: Number(input.x), y: Number(input.y) }
        : null;
    const element = point
      ? document.elementFromPoint(point.x, point.y)
      : requireElement(input);
    if (!element) throw new Error(`No element at (${point.x}, ${point.y})`);
    if ("disabled" in element && element.disabled) throw new Error("Element is disabled");
    element.scrollIntoView({ block: "center", inline: "center", behavior: "instant" });
    element.focus?.({ preventScroll: true });
    dispatchPointerSequence(element, point);
    return { clicked: true, element: describeElement(element) };
  };

  const setNativeValue = (element, value) => {
    const prototype =
      element instanceof HTMLTextAreaElement
        ? HTMLTextAreaElement.prototype
        : element instanceof HTMLInputElement
          ? HTMLInputElement.prototype
          : null;
    const setter = prototype
      ? Object.getOwnPropertyDescriptor(prototype, "value")?.set
      : undefined;
    if (setter) setter.call(element, value);
    else if ("value" in element) element.value = value;
    else element.textContent = value;
  };

  const typeInto = (input) => {
    const element = requireElement(input);
    const value = String(input?.text ?? "");
    element.scrollIntoView({ block: "center", inline: "nearest", behavior: "instant" });
    element.focus?.({ preventScroll: true });
    if (element instanceof HTMLSelectElement) {
      element.value = value;
    } else if (element.isContentEditable) {
      element.textContent = value;
    } else {
      setNativeValue(element, value);
    }
    element.dispatchEvent(
      new InputEvent("input", {
        bubbles: true,
        composed: true,
        inputType: "insertText",
        data: value,
      }),
    );
    element.dispatchEvent(new Event("change", { bubbles: true, composed: true }));
    if (input?.submit) {
      const form = element instanceof HTMLElement ? element.closest("form") : null;
      if (form instanceof HTMLFormElement) form.requestSubmit();
      else dispatchKey(element, "Enter");
    }
    return { typed: true, length: value.length, element: describeElement(element) };
  };

  const dispatchKey = (element, key) => {
    const normalizedKey = String(key || "").trim();
    if (!normalizedKey) throw new Error("key is required");
    element.focus?.({ preventScroll: true });
    const options = {
      key: normalizedKey,
      code: normalizedKey.length === 1 ? `Key${normalizedKey.toUpperCase()}` : normalizedKey,
      bubbles: true,
      cancelable: true,
      composed: true,
    };
    const accepted = element.dispatchEvent(new KeyboardEvent("keydown", options));
    if (accepted && normalizedKey === "Enter") {
      const form = element instanceof HTMLElement ? element.closest("form") : null;
      if (form instanceof HTMLFormElement) form.requestSubmit();
    }
    element.dispatchEvent(new KeyboardEvent("keyup", options));
    return { pressed: true, key: normalizedKey, element: describeElement(element) };
  };

  const pressKey = (input) => {
    const target = input?.ref || input?.selector
      ? requireElement(input)
      : document.activeElement instanceof Element
        ? document.activeElement
        : document.body;
    return dispatchKey(target, input?.key);
  };

  const getText = (input) => {
    const element = input?.selector || input?.ref ? requireElement(input) : document.body;
    const value = String(element.innerText || element.textContent || "").slice(0, MAX_TEXT);
    return {
      text: value,
      length: value.length,
      truncated: value.length >= MAX_TEXT,
      url: location.href,
      title: document.title,
    };
  };

  const getReadable = () => {
    const selectors = [
      "article",
      "[role='main']",
      "main",
      ".post-content",
      ".article-body",
      ".entry-content",
      "#content",
      ".content",
    ];
    const element =
      selectors.map((selector) => document.querySelector(selector)).find((node) => node && visible(node) && text(node, 1)) ||
      document.body;
    const value = String(element.innerText || element.textContent || "")
      .replace(/\n{3,}/g, "\n\n")
      .trim()
      .slice(0, MAX_TEXT);
    return {
      title: document.title,
      text: value,
      length: value.length,
      source: elementSelector(element) || "body",
      url: location.href,
    };
  };

  const findScrollable = () => {
    const candidates = Array.from(document.querySelectorAll("body *"))
      .filter((element) => {
        const style = getComputedStyle(element);
        return (
          visible(element) &&
          (style.overflowY === "auto" || style.overflowY === "scroll") &&
          element.scrollHeight > element.clientHeight + 5
        );
      })
      .sort(
        (left, right) =>
          right.clientWidth * right.clientHeight - left.clientWidth * left.clientHeight,
      );
    return candidates[0] || document.scrollingElement || document.documentElement;
  };

  const scroll = (input) => {
    const direction = ["up", "down", "left", "right"].includes(input?.direction)
      ? input.direction
      : "down";
    const amount = Math.max(1, Math.min(10_000, Number(input?.amount) || 600));
    const target = input?.selector || input?.ref ? requireElement(input) : findScrollable();
    const horizontal = direction === "left" || direction === "right";
    const delta = direction === "up" || direction === "left" ? -amount : amount;
    const before = horizontal
      ? target === document.scrollingElement ? window.scrollX : target.scrollLeft
      : target === document.scrollingElement ? window.scrollY : target.scrollTop;
    if (target === document.scrollingElement || target === document.documentElement) {
      window.scrollBy({
        left: horizontal ? delta : 0,
        top: horizontal ? 0 : delta,
        behavior: input?.smooth ? "smooth" : "instant",
      });
    } else {
      target.scrollBy({
        left: horizontal ? delta : 0,
        top: horizontal ? 0 : delta,
        behavior: input?.smooth ? "smooth" : "instant",
      });
    }
    const after = horizontal
      ? target === document.scrollingElement ? window.scrollX : target.scrollLeft
      : target === document.scrollingElement ? window.scrollY : target.scrollTop;
    return {
      scrolled: before !== after,
      direction,
      amount,
      before,
      after,
      target: elementSelector(target),
    };
  };

  const hover = (input) => {
    const element = requireElement(input);
    const rect = element.getBoundingClientRect();
    const options = {
      bubbles: true,
      composed: true,
      clientX: rect.x + rect.width / 2,
      clientY: rect.y + rect.height / 2,
    };
    element.dispatchEvent(new PointerEvent("pointerover", options));
    element.dispatchEvent(new MouseEvent("mouseover", options));
    return { hovered: true, element: describeElement(element) };
  };

  const findElements = (input) => {
    const selector = String(input?.selector || "a,button,input,textarea,select,[role='button']");
    const limit = Math.max(1, Math.min(MAX_ELEMENTS, Number(input?.limit) || 30));
    const all = Array.from(document.querySelectorAll(selector));
    return {
      count: all.length,
      shown: Math.min(all.length, limit),
      elements: all.slice(0, limit).map(describeElement),
    };
  };

  const pageInfo = () => ({
    url: location.href,
    title: document.title,
    readyState: document.readyState,
    language: document.documentElement.lang || navigator.language,
    userAgent: navigator.userAgent,
    scrollX: window.scrollX,
    scrollY: window.scrollY,
    scrollWidth: Math.max(document.body?.scrollWidth || 0, document.documentElement.scrollWidth),
    scrollHeight: Math.max(document.body?.scrollHeight || 0, document.documentElement.scrollHeight),
    viewportWidth: window.innerWidth,
    viewportHeight: window.innerHeight,
    links: document.links.length,
    forms: document.forms.length,
  });

  const backbone = (input) => {
    const maxDepth = Math.max(1, Math.min(8, Number(input?.maxDepth) || 5));
    const maxNodes = Math.max(10, Math.min(800, Number(input?.maxNodes) || 240));
    let seen = 0;

    const visit = (element, depth) => {
      if (!(element instanceof Element) || depth > maxDepth || seen >= maxNodes) return null;
      const interactive =
        element.matches(
          "a,button,input,textarea,select,summary,[role='button'],[role='link'],[role='textbox'],[contenteditable='true']",
        ) || Boolean(element.onclick);
      const meaningful = interactive || text(element, 1) || element.children.length > 0;
      if (!meaningful || (!visible(element) && depth > 1)) return null;
      seen += 1;
      const children = [];
      for (const child of element.children) {
        const node = visit(child, depth + 1);
        if (node) children.push(node);
        if (seen >= maxNodes) break;
      }
      const description = describeElement(element);
      return {
        ref: description.ref,
        tag: description.tag,
        selector: description.selector,
        role: description.role,
        name: description.name,
        type: description.type,
        text: description.text,
        href: description.href,
        value: description.value,
        interactive,
        children,
      };
    };

    return {
      url: location.href,
      title: document.title,
      nodeCount: seen,
      truncated: seen >= maxNodes,
      tree: visit(document.body, 0),
    };
  };

  const executeScript = (input) => {
    const source = String(input?.script || "");
    if (!source) throw new Error("script is required");
    const result = Function(`"use strict";\n${source}`)();
    if (result && typeof result.then === "function") {
      throw new Error("Asynchronous scripts are not supported by execute_js");
    }
    return { result: result === undefined ? null : result };
  };

  const execute = (action, input = {}) => {
    try {
      let data;
      switch (action) {
        case "click":
          data = click(input);
          break;
        case "type":
          data = typeInto(input);
          break;
        case "press_key":
          data = pressKey(input);
          break;
        case "get_text":
          data = getText(input);
          break;
        case "readable":
          data = getReadable();
          break;
        case "scroll":
          data = scroll(input);
          break;
        case "hover":
          data = hover(input);
          break;
        case "find_elements":
          data = findElements(input);
          break;
        case "page_info":
          data = pageInfo();
          break;
        case "backbone":
        case "snapshot":
          data = backbone(input);
          break;
        case "execute_js":
          data = executeScript(input);
          break;
        default:
          throw new Error(`Unsupported DOM action: ${action}`);
      }
      return JSON.stringify({ ok: true, data });
    } catch (error) {
      return JSON.stringify({
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  };

  Object.defineProperty(window, "__xgentBrowserRuntime", {
    configurable: true,
    enumerable: false,
    writable: false,
    value: Object.freeze({ version: 1, execute }),
  });
})();
