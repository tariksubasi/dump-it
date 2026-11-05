import { act, fireEvent, render } from "@testing-library/react";
import { ListValue, ObjectItem, ValueStatus } from "mendix";
import * as builders from "mendix/filters/builders";

import { CardList } from "../CardList";
import { buildSearchFilter, nextLimit, normalizeQuery } from "../searchLogic";
import { CardListContainerProps } from "../../typings/CardListProps";

jest.mock(
    "mendix/hooks",
    () => ({ usePersistentState: (_k: string, v: unknown) => jest.requireActual("react").useState(v) }),
    { virtual: true }
);

const b = builders as unknown as Record<string, jest.Mock>;
beforeEach(() => {
    b.attribute.mockImplementation((id: string) => ({ attr: id }));
    b.literal.mockImplementation((v: string) => ({ lit: v }));
    b.contains.mockImplementation((a: unknown, l: unknown) => ({ contains: [a, l] }));
    b.or.mockImplementation((...a: unknown[]) => ({ or: a }));
    b.and.mockImplementation((...a: unknown[]) => ({ and: a }));
});

const field = (id: string, filterable = true): any => ({ id, filterable, get: () => ({ displayValue: id }) });

function list(items: ObjectItem[], extra: Partial<ListValue> = {}): ListValue {
    return {
        status: ValueStatus.Available,
        items,
        offset: 0,
        limit: 20,
        hasMoreItems: false,
        sortOrder: [],
        filter: undefined,
        setFilter: jest.fn(),
        setLimit: jest.fn(),
        setOffset: jest.fn(),
        setSortOrder: jest.fn(),
        requestTotalCount: jest.fn(),
        reload: jest.fn(),
        ...extra
    } as unknown as ListValue;
}

function props(ds: ListValue, extra: Partial<CardListContainerProps> = {}): CardListContainerProps {
    return {
        name: "cards",
        class: "",
        ds,
        title: { id: "Name", filterable: true, get: (i: ObjectItem) => ({ displayValue: `Name ${i.id}` }) } as any,
        searchFields: [{ attr: field("Name") }, { attr: field("Email") }],
        debounceMs: 300,
        minChars: 2,
        pageSize: 20,
        ...extra
    } as CardListContainerProps;
}

describe("search logic", () => {
    it("normalizes text and applies the minimum length", () => {
        expect(normalizeQuery("  ali   veli ", 2)).toBe("ali veli");
        expect(normalizeQuery("a", 2)).toBe("");
        expect(normalizeQuery("", 0)).toBe("");
    });

    it("every word must match one of the fields; not filterable fields are skipped", () => {
        const f = buildSearchFilter("ali yılmaz", [field("Name"), field("Email"), field("Bio", false), undefined]);
        expect(f).toEqual({
            and: [
                {
                    or: [
                        { contains: [{ attr: "Name" }, { lit: "ali" }] },
                        { contains: [{ attr: "Email" }, { lit: "ali" }] }
                    ]
                },
                {
                    or: [
                        { contains: [{ attr: "Name" }, { lit: "yılmaz" }] },
                        { contains: [{ attr: "Email" }, { lit: "yılmaz" }] }
                    ]
                }
            ]
        });
        expect(buildSearchFilter("x", [field("Bio", false)])).toBeUndefined();
        expect(buildSearchFilter("", [field("Name")])).toBeUndefined();
    });

    it("next limit only when there is more and nothing is loading", () => {
        expect(nextLimit({ limit: 20, hasMoreItems: true, status: ValueStatus.Available }, 20)).toBe(40);
        expect(nextLimit({ limit: 20, hasMoreItems: false, status: ValueStatus.Available }, 20)).toBeUndefined();
        expect(nextLimit({ limit: 20, hasMoreItems: true, status: ValueStatus.Loading }, 20)).toBeUndefined();
    });
});

describe("CardList", () => {
    beforeEach(() => jest.useFakeTimers());
    afterEach(() => jest.useRealTimers());

    it("debounces typing into one server filter and restarts paging", () => {
        const ds = list([{ id: "1" } as ObjectItem]);
        const r = render(<CardList {...props(ds)} />);
        const input = r.getByRole("searchbox");
        fireEvent.change(input, { target: { value: "a" } });
        fireEvent.change(input, { target: { value: "al" } });
        fireEvent.change(input, { target: { value: "ali" } });
        act(() => jest.advanceTimersByTime(299));
        expect(ds.setFilter).not.toHaveBeenCalled();
        act(() => jest.advanceTimersByTime(1));
        expect(ds.setFilter).toHaveBeenCalledTimes(1);
        expect((ds.setFilter as jest.Mock).mock.calls[0][0]).toEqual({
            or: [{ contains: [{ attr: "Name" }, { lit: "ali" }] }, { contains: [{ attr: "Email" }, { lit: "ali" }] }]
        });
        expect(ds.setLimit).toHaveBeenLastCalledWith(20);
    });

    it("clearing the search removes the filter", () => {
        const ds = list([]);
        const r = render(<CardList {...props(ds)} />);
        const input = r.getByRole("searchbox");
        fireEvent.change(input, { target: { value: "ali" } });
        act(() => jest.advanceTimersByTime(300));
        fireEvent.change(input, { target: { value: "" } });
        act(() => jest.advanceTimersByTime(300));
        expect((ds.setFilter as jest.Mock).mock.calls.pop()[0]).toBeUndefined();
    });

    it("shows empty text vs no-results text", () => {
        const empty = render(<CardList {...props(list([]))} />);
        expect(empty.getByText("No items")).toBeTruthy();
        const ds = list([]);
        const r = render(<CardList {...props(ds)} />);
        fireEvent.change(r.getAllByRole("searchbox")[1], { target: { value: "zzz" } });
        act(() => jest.advanceTimersByTime(300));
        expect(r.getByText("No results")).toBeTruthy();
    });

    it("load more increases the limit; skeleton on first load", () => {
        const ds = list([{ id: "1" } as ObjectItem], { hasMoreItems: true });
        const r = render(<CardList {...props(ds)} />);
        fireEvent.click(r.getByText("Load more"));
        expect(ds.setLimit).toHaveBeenLastCalledWith(40);
        const loading = render(<CardList {...props(list([], { status: ValueStatus.Loading }))} />);
        expect(loading.container.querySelectorAll(".is-skeleton").length).toBe(3);
    });
});
