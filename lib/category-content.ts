import { CATEGORIES, type Category } from "./market";

const content: Record<Category, { label: string; description: string }> = {
  ai: {
    label: "AI",
    description: "Owner-verified open-source models, agents, inference tools, and supporting infrastructure.",
  },
  developer: {
    label: "Developer tools",
    description: "Open-source libraries, runtimes, deployment tools, databases, and software-development infrastructure.",
  },
  design: {
    label: "Design tools",
    description: "Open-source interfaces, design systems, creative tools, and media-production software.",
  },
  commerce: {
    label: "Commerce",
    description: "Open-source software for payments, storefronts, operations, accounting, and online business.",
  },
  consumer: {
    label: "Consumer software",
    description: "Open-source applications built for personal productivity, communication, media, and everyday use.",
  },
  other: {
    label: "Other projects",
    description: "Owner-verified open-source projects that do not fit the five primary Bidstage categories.",
  },
};

export function isCategory(value: string): value is Category {
  return CATEGORIES.includes(value as Category);
}

export function categoryContent(category: Category) {
  return content[category];
}

export function categoryPageTitle(category: Category) {
  const label = content[category].label;
  return category === "other"
    ? "Other open-source projects"
    : `${label} open-source projects`;
}
