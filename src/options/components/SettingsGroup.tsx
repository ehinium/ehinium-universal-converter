import { Children, Fragment, type ReactNode } from "react";
import { Card } from "../../components/ui/card";
import { FieldGroup } from "../../components/ui/field";
import { Separator } from "../../components/ui/separator";

type SettingsGroupProps = {
  children: ReactNode;
};

export function SettingsGroup({ children }: SettingsGroupProps) {
  const rows = Children.toArray(children);

  return (
    <Card className="gap-0 overflow-hidden py-0">
      <FieldGroup className="gap-0">
          {rows.map((row, index) => (
            <Fragment key={index}>
              {index > 0 ? <Separator /> : null}
              {row}
            </Fragment>
          ))}
      </FieldGroup>
    </Card>
  );
}
