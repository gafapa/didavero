const controls = [...document.querySelectorAll('[data-workflow]')];
const panels = [...document.querySelectorAll('[data-panel]')];
function selectWorkflow(id) {
  for (const button of controls) button.setAttribute('aria-pressed', String(button.dataset.workflow === id));
  for (const panel of panels) panel.hidden = panel.dataset.panel !== id;
}
for (const button of controls) button.addEventListener('click', () => selectWorkflow(button.dataset.workflow));
if (controls.length) selectWorkflow('notes');
if ('IntersectionObserver' in window && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
  const observer = new IntersectionObserver(entries => {
    for (const entry of entries) if (entry.isIntersecting) { entry.target.classList.add('arrived'); observer.unobserve(entry.target); }
  }, { threshold: 0.08 });
  for (const element of document.querySelectorAll('.motion')) observer.observe(element);
}
