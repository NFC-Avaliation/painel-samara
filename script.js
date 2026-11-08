document.addEventListener("DOMContentLoaded", () => {
const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const revealItems = document.querySelectorAll(".reveal, .wipe-in, .motion-scene");
document.documentElement.classList.add("motion-ready");

if (reducedMotion || !("IntersectionObserver" in window)) {
  revealItems.forEach((item) => item.classList.add("is-visible"));
  document.querySelectorAll(".motion-scene").forEach((scene) => scene.classList.add("is-playing"));
} else {
  const revealObserver = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (entry.isIntersecting) {
        const delay = Number(entry.target.dataset.delay || 0);
        entry.target.style.setProperty("--delay", `${delay}ms`);
        entry.target.classList.add("is-visible");
        entry.target.classList.add("is-playing");
      } else {
        entry.target.classList.remove("is-visible");
        entry.target.classList.remove("is-playing");
      }
    });
  }, { threshold: 0.08, rootMargin: "0px 0px -8% 0px" });

  revealItems.forEach((item) => revealObserver.observe(item));
}

const menuToggle = document.querySelector(".menu-toggle");
const siteNav = document.querySelector(".site-nav");

menuToggle?.addEventListener("click", () => {
  const isOpen = menuToggle.getAttribute("aria-expanded") === "true";
  menuToggle.setAttribute("aria-expanded", String(!isOpen));
  siteNav?.classList.toggle("open", !isOpen);
});

siteNav?.querySelectorAll("a").forEach((link) => {
  link.addEventListener("click", () => {
    menuToggle?.setAttribute("aria-expanded", "false");
    siteNav.classList.remove("open");
  });
});

document.addEventListener("click", (event) => {
  if (!siteNav?.classList.contains("open")) return;
  if (siteNav.contains(event.target) || menuToggle?.contains(event.target)) return;
  siteNav.classList.remove("open");
  menuToggle?.setAttribute("aria-expanded", "false");
});

});

