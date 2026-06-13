import { parseFieldName } from "./fieldMetadata.ts";
import type { CardField } from "./model";

export interface FieldNodeLike {
    name?: string;
    type?: string;
    id?: string;
    fills?: any;
    children?: any[];
}

export interface CardDataHandlers<TField extends FieldNodeLike = FieldNodeLike> {
    assignTextField(field: TField, value: string): void;
    assignImageField(field: TField, value: string): void;
}

export function isValidVariableField(shape: FieldNodeLike) {
    return Boolean(
        shape.name?.startsWith("#") &&
        (
            shape.type === "text" ||
            (
                shape.type === "rectangle" &&
                shape.fills?.length === 1 &&
                shape.fills[0]?.fillImage
            )
        )
    );
}

function walkFields(board: FieldNodeLike, fields: CardField[], seenNames: Set<string>) {
    if (!board.children?.length) {
        return;
    }

    for (const child of board.children) {
        if (isValidVariableField(child)) {
            const metadata = parseFieldName(child.name as string);
            if (!seenNames.has(metadata.name)) {
                seenNames.add(metadata.name);
                fields.push({ ...metadata, type: child.type === "text" ? "text" : "image", id: child.id as string });
            }
        }

        if (child.children?.length) {
            walkFields(child, fields, seenNames);
        }
    }
}

export function collectCardFields(boards: FieldNodeLike[]) {
    const fields: CardField[] = [];
    const seenNames = new Set<string>();

    for (const board of boards) {
        walkFields(board, fields, seenNames);
    }

    return fields;
}

export function findByFieldName(parent: FieldNodeLike, fieldName: string): FieldNodeLike | undefined {
    if (!parent.children?.length) {
        return undefined;
    }

    for (const child of parent.children) {
        if (child.name && parseFieldName(child.name).name === fieldName) {
            return child;
        }

        if (child.children?.length) {
            const inner = findByFieldName(child, fieldName);
            if (inner) {
                return inner;
            }
        }
    }

    return undefined;
}

export function applyCardDataToTree<TField extends FieldNodeLike>(
    parent: TField,
    cardData: Record<string, any>,
    handlers: CardDataHandlers<TField>,
) {
    for (const prop in cardData) {
        if (!Object.prototype.hasOwnProperty.call(cardData, prop)) {
            continue;
        }

        const field = findByFieldName(parent, prop) as TField | undefined;
        if (!field) {
            continue;
        }

        if (field.type === "text") {
            handlers.assignTextField(field, cardData[prop]);
        } else {
            handlers.assignImageField(field, cardData[prop]);
        }
    }
}
