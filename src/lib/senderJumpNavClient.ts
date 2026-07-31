const OPEN_CLASS = "sender-jump--open";

export function senderMatchesQuery(searchText: string, query: string): boolean {
  const normalizedQuery = query.trim().toLocaleLowerCase("zh-TW");
  return !normalizedQuery || searchText.toLocaleLowerCase("zh-TW").includes(normalizedQuery);
}

export function setActiveSenderLink(links: HTMLAnchorElement[], targetId: string): void {
  for (const link of links) {
    const active = link.dataset.target === targetId;
    link.classList.toggle("is-active", active);
    if (active) link.setAttribute("aria-current", "location");
    else link.removeAttribute("aria-current");
  }
}

export function initSenderJumpNav(root: HTMLElement): () => void {
  if (root.dataset.ready === "true") return () => {};
  root.dataset.ready = "true";

  const trigger = root.querySelector<HTMLButtonElement>(".sender-jump-trigger");
  const close = root.querySelector<HTMLButtonElement>(".sender-jump-close");
  const search = root.querySelector<HTMLInputElement>('input[type="search"]');
  const links = [...root.querySelectorAll<HTMLAnchorElement>(".sender-jump-link")];
  const empty = root.querySelector<HTMLElement>(".sender-jump-empty");

  const setOpen = (open: boolean, restoreFocus = false) => {
    root.classList.toggle(OPEN_CLASS, open);
    trigger?.setAttribute("aria-expanded", String(open));
    if (open) {
      (search ?? links[0] ?? close)?.focus();
    } else if (restoreFocus) {
      trigger?.focus();
    }
  };

  const onTriggerClick = () => setOpen(!root.classList.contains(OPEN_CLASS));
  const onCloseClick = () => setOpen(false, true);
  const onSearchInput = () => {
    const query = search?.value ?? "";
    let visibleCount = 0;
    for (const link of links) {
      const visible = senderMatchesQuery(link.dataset.search ?? "", query);
      link.hidden = !visible;
      if (visible) visibleCount += 1;
    }
    if (empty) empty.hidden = visibleCount > 0;
  };
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === "Escape" && root.classList.contains(OPEN_CLASS)) {
      setOpen(false, true);
    }
  };
  const onPointerDown = (event: PointerEvent) => {
    if (
      root.classList.contains(OPEN_CLASS)
      && event.target
      && !root.contains(event.target as Node)
    ) {
      setOpen(false);
    }
  };

  trigger?.addEventListener("click", onTriggerClick);
  close?.addEventListener("click", onCloseClick);
  search?.addEventListener("input", onSearchInput);
  document.addEventListener("keydown", onKeyDown);
  document.addEventListener("pointerdown", onPointerDown);

  const linkHandlers = new Map<HTMLAnchorElement, () => void>();
  for (const link of links) {
    const handler = () => {
      const targetId = link.dataset.target ?? "";
      const target = document.getElementById(targetId);
      if (target?.tagName === "DETAILS") {
        (target as HTMLDetailsElement).open = true;
      }
      setActiveSenderLink(links, targetId);
      setOpen(false);
    };
    linkHandlers.set(link, handler);
    link.addEventListener("click", handler);
  }

  const targets = links
    .map((link) => document.getElementById(link.dataset.target ?? ""))
    .filter((target): target is HTMLElement => target !== null);

  const observer = "IntersectionObserver" in window && targets.length > 0
    ? new IntersectionObserver((entries) => {
        const visible = entries
          .filter((entry) => entry.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
        if (visible) setActiveSenderLink(links, visible.target.id);
      }, { rootMargin: "-18% 0px -70% 0px", threshold: 0 })
    : null;

  targets.forEach((target) => observer?.observe(target));

  return () => {
    delete root.dataset.ready;
    trigger?.removeEventListener("click", onTriggerClick);
    close?.removeEventListener("click", onCloseClick);
    search?.removeEventListener("input", onSearchInput);
    document.removeEventListener("keydown", onKeyDown);
    document.removeEventListener("pointerdown", onPointerDown);
    for (const [link, handler] of linkHandlers) link.removeEventListener("click", handler);
    observer?.disconnect();
  };
}
