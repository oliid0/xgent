import typography from "@tailwindcss/typography";

/** @type {import("tailwindcss").Config} */
const config = {
  darkMode: ["class"],
  content: [
    "./index.html",
    "./src/**/*.{ts,tsx}",
    "./node_modules/streamdown/dist/*.js",
    "./node_modules/@streamdown/code/dist/*.js",
    "./node_modules/@streamdown/cjk/dist/*.js",
    "./node_modules/@streamdown/math/dist/*.js",
    "./node_modules/@streamdown/mermaid/dist/*.js",
  ],
  theme: {
    extend: {
      colors: {
        border: "var(--color-border)",
        input: "var(--color-border)",
        ring: "var(--color-accent)",
        background: "var(--color-background-surface)",
        foreground: "var(--color-text-primary)",
        primary: {
          DEFAULT: "var(--color-accent)",
          foreground: "var(--color-on-accent)",
        },
        secondary: {
          DEFAULT: "var(--color-background-muted)",
          foreground: "var(--color-text-primary)",
        },
        destructive: {
          DEFAULT: "var(--color-error)",
          foreground: "var(--color-on-error)",
        },
        muted: {
          DEFAULT: "var(--color-background-muted)",
          foreground: "var(--color-text-secondary)",
        },
        accent: {
          DEFAULT: "var(--color-accent-muted)",
          foreground: "var(--color-text-accent)",
        },
        popover: {
          DEFAULT: "var(--color-background-popover)",
          foreground: "var(--color-text-primary)",
        },
        card: {
          DEFAULT: "var(--color-background-card)",
          foreground: "var(--color-text-primary)",
        },
        sidebar: {
          DEFAULT: "var(--color-background-body)",
          foreground: "var(--color-text-primary)",
        },
        chip: {
          DEFAULT: "var(--color-neutral)",
          hover: "var(--color-overlay-hover)",
        },
        "send-disabled": "var(--color-neutral)",
      },
      borderRadius: {
        lg: "var(--radius-container)",
        md: "var(--radius-element)",
        sm: "var(--radius-inner)",
      },
    },
  },
  plugins: [typography],
};

export default config;
