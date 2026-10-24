/* Small, distinct family portraits. Labels belong in the surrounding control. */
(function () {
  const portraits = {
    self: `
      <path fill="currentColor" d="M6 37c.2-7 5-11 14-11s13.8 4 14 11H6Z"/>
      <path fill="var(--person-bg, #e5eddd)" d="m15 27 5 5 5-5-2-2h-6l-2 2Z"/>
      <path fill="currentColor" d="M10 16V13C10 6 15 3 21 3c6 0 10 4 10 10v6H10v-3Z"/>
      <path fill="var(--person-bg, #e5eddd)" d="M13 14c4 .3 8-1.1 11-4 1 2 2 3.3 4 4v6c0 5-3.4 8-7.5 8S13 25 13 20v-6Z"/>
      <path fill="currentColor" d="M16.4 18a1.1 1.1 0 1 0 0 2.2 1.1 1.1 0 0 0 0-2.2Zm8.1 0a1.1 1.1 0 1 0 0 2.2 1.1 1.1 0 0 0 0-2.2Z"/>
      <path d="M18 23.3c1.5 1 3.5 1 5 0" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>
    `,
    mom: `
      <path fill="currentColor" d="M8 16C8 7 12.8 3 20 3s12 4 12 13v14H8V16Z"/>
      <path fill="currentColor" d="M5.5 37C6.4 29 12 26 20 26s13.6 3 14.5 11h-29Z"/>
      <path fill="var(--person-bg, #eee6ed)" d="M13 14c4-.4 7.7-2.3 10-5 1.2 3.1 2.6 4.8 4 5.6V20c0 4.8-2.9 7.7-7 7.7S13 24.8 13 20v-6Z"/>
      <path fill="var(--person-bg, #eee6ed)" d="m15.5 28 4.5 5 4.5-5h-9Z"/>
      <path fill="currentColor" d="M16.2 18a1.1 1.1 0 1 0 0 2.2 1.1 1.1 0 0 0 0-2.2Zm7.6 0a1.1 1.1 0 1 0 0 2.2 1.1 1.1 0 0 0 0-2.2Z"/>
      <path d="M17.7 23.2c1.4 1.1 3.2 1.1 4.6 0" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>
    `,
    grandpa: `
      <path fill="currentColor" d="M5.5 37c.5-7.6 5.8-11.2 14.5-11.2S34 29.4 34.5 37h-29Z"/>
      <path fill="var(--person-bg, #f3eadb)" d="m14.5 27 5.5 6 5.5-6-2.5-2h-6l-2.5 2Z"/>
      <path fill="var(--person-bg, #f3eadb)" stroke="currentColor" stroke-width="1.8" d="M11.3 14.5c0-6.5 3.6-10 8.7-10s8.7 3.5 8.7 10V20c0 5-3.5 8-8.7 8s-8.7-3-8.7-8v-5.5Z"/>
      <path fill="currentColor" d="M10.5 13.2c0-3.5 1.4-6.1 3.8-7.7l.6 6-1.9 3.8v5.1h-2.5v-7.2Zm19 0c0-3.5-1.4-6.1-3.8-7.7l-.6 6 1.9 3.8v5.1h2.5v-7.2Z"/>
      <g fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round">
        <rect x="12.2" y="15" width="6.2" height="5.5" rx="1.8"/>
        <rect x="21.6" y="15" width="6.2" height="5.5" rx="1.8"/>
        <path d="M18.4 17h3.2"/>
      </g>
      <path d="M17.3 23.7c1.8 1 3.6 1 5.4 0" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>
    `
  };

  window.personPortrait = function personPortrait(member) {
    const id = typeof member === 'string' ? member : member?.id;
    const key = Object.prototype.hasOwnProperty.call(portraits, id) ? id : 'self';
    return `<svg class="person-portrait" data-portrait="${key}" viewBox="0 0 40 40" aria-hidden="true" focusable="false">${portraits[key]}</svg>`;
  };
})();
