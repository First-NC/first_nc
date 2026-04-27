export const UTILITY_MENU_CONTROL_ORDER = ["language", "theme", "shortcuts", "help"] as const;

export const HELP_MENU_ACTION_ORDER = ["checkUpdate", "about"] as const;

export type UtilityMenuControlId = (typeof UTILITY_MENU_CONTROL_ORDER)[number];
export type HelpMenuActionId = (typeof HELP_MENU_ACTION_ORDER)[number];
