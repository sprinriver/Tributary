import { QueryBuilder, type Field, type RuleGroupType } from 'react-querybuilder';
import 'react-querybuilder/dist/query-builder.css';

/** react-querybuilder with typed operators per column, AND/OR, nested groups and NOT (SPEC M6). */
export function FilterBuilder({
  label,
  fields,
  query,
  onChange,
}: {
  label: string;
  fields: Field[];
  query: RuleGroupType;
  onChange: (q: RuleGroupType) => void;
}) {
  return (
    <section role="region" aria-label={label} className="filter-builder">
      <QueryBuilder
        fields={fields}
        query={query}
        onQueryChange={onChange}
        showNotToggle
        resetOnFieldChange
        resetOnOperatorChange={false}
        controlClassnames={{ queryBuilder: 'queryBuilder-branches' }}
        translations={{
          fields: { title: 'Fields' },
          operators: { title: 'Operators' },
          value: { title: 'Value' },
        }}
      />
    </section>
  );
}
