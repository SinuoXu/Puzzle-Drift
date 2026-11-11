export const taskCategories = [
  { value: "all", label: "全部" },
  { value: "receive", label: "收货留存" },
  { value: "ship", label: "发货留存" },
  { value: "shipping_fee", label: "填写邮费" },
  { value: "pay", label: "支付邮费" },
] as const;

export type TaskCategory = typeof taskCategories[number]["value"];

type SearchableTask = {
  kind: string;
  puzzle_name: string;
  merged_puzzle_names?: string[];
};

type SearchableGroup = {
  puzzle_names: string[];
  shipping_done: boolean;
  fee_done: boolean;
};

function normalizeName(value: string) {
  return value.normalize("NFKC").toLowerCase().replace(/\s+/gu, "");
}

// Search stays on the device; changing filters never reads or writes the store.
export function filterTaskCards<T extends SearchableTask, G extends SearchableGroup>(
  tasks: T[],
  groups: G[],
  category: TaskCategory,
  query: string,
) {
  const terms = query.split(/[\s,，、;；]+/u).map(normalizeName).filter(Boolean);
  const matchesName = (names: string[]) => terms.length === 0 || names.some(
    (name) => terms.some((term) => normalizeName(name).includes(term)),
  );
  const namedTasks = tasks.filter((task) => matchesName([
    task.puzzle_name,
    ...(task.merged_puzzle_names ?? []),
  ]));
  const namedGroups = groups.filter((group) => matchesName(group.puzzle_names));
  const matchesTask = (task: T, value: TaskCategory) => value === "all" || (
    value === "pay"
      ? task.kind === "pay_shipping" || task.kind === "pay_return"
      : task.kind === value
  );
  const matchesGroup = (group: G, value: TaskCategory) => value === "all" || (
    value === "ship" && !group.shipping_done
  ) || (value === "shipping_fee" && !group.fee_done);
  const counts = Object.fromEntries(taskCategories.map(({ value }) => [
    value,
    namedTasks.filter((task) => matchesTask(task, value)).length +
      namedGroups.filter((group) => matchesGroup(group, value)).length,
  ])) as Record<TaskCategory, number>;

  return {
    tasks: namedTasks.filter((task) => matchesTask(task, category)),
    groups: namedGroups.filter((group) => matchesGroup(group, category)),
    counts,
  };
}
