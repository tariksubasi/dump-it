---
name: mendix-java-action
description: Write Mendix 10.24 (10.24.13) Java actions end to end - define the action, write executeAction() between BEGIN/END USER CODE, create objects, set attributes and associations (reference and reference set), commit, retrieve with XPath or over an association, call microflows, and call the action from a microflow. Use when the user asks for a Java action, server-side custom logic, or "Java ile" in a Mendix 10 app.
---

# Mendix 10.24 Java actions

A Java action is server-side code that a microflow calls. Studio Pro generates the class skeleton
`javasource/<module>/actions/<Name>.java`. You write code only in the three kept regions.

Target: Mendix Studio Pro **10.24.13**, Mendix Runtime Java API 10. Write Java 17-compatible code
(10.24 runs on JDK 17 or 21).

## 1. What you must know (summary table)

| Topic | Rule for 10.24.13 | Why it matters |
|---|---|---|
| File | `javasource/<module lower-case>/actions/<Name>.java`, class `<Name> extends UserAction<ReturnType>` | Studio Pro regenerates it on save/deploy |
| Kept regions | Import list, `// BEGIN USER CODE`…`// END USER CODE`, `// BEGIN EXTRA CODE`…`// END EXTRA CODE` | Code anywhere else is lost |
| Entry point | `public <ReturnType> executeAction() throws Exception` | Return value goes to the microflow |
| Context | `getContext()` = the caller's context (user rights apply). `getContext().createSudoClone()` = same user, no access checks. `Core.createSystemContext()` = system, no user | Wrong context → security errors or data leaks |
| Object parameter | Field `Name` is the **proxy** (`module.proxies.Entity`); `__Name` is the raw `IMendixObject` (deprecated) | Use the proxy field |
| List parameter | Field is `java.util.List<module.proxies.Entity>` (never null; empty list when empty) | |
| Primitive types | String → `String`, Integer/Long → `Long`, Decimal → `java.math.BigDecimal`, Boolean → `Boolean`, DateTime → `java.util.Date`, Enumeration → `module.proxies.EnumName` | Do not use `double` for Decimal |
| Entity type parameter | `java.lang.String` = entity name, e.g. `"Sales.Order"` | Use with `Core.instantiate` |
| Microflow parameter | `java.lang.String` = microflow name; call it with `Core.microflowCall(name)` | **Required** in 10.24.13 (optional only from 10.24.22) |
| Proxies | Generated in `javasource/<module>/proxies/` by Studio Pro on deploy; regenerated each time | Never edit proxy files |
| Create | `new Order(getContext())` (proxy) or `Core.instantiate(getContext(), "Sales.Order")` | 10.24 proxies have no `create()` / `commit()` helpers |
| Attribute | `order.setNumber("A1")`, `order.getTotal()`; raw: `obj.setValue(ctx, "Number", "A1")` | Member name = attribute name without module |
| Reference (1-*) | Owner side only: `order.setOrder_Customer(customer)`; raw: `obj.setValue(ctx, "Sales.Order_Customer", customer.getMendixObject().getId())` | Raw needs the **qualified** association name and an `IMendixIdentifier` |
| Reference set (*-*) | `order.setOrder_Tag(listOfTagProxies)`; raw: `obj.setValue(ctx, "Sales.Order_Tag", List<IMendixIdentifier>)` | Setter **replaces** the whole set |
| Commit | `Core.commit(getContext(), order.getMendixObject())`; lists: `Core.commit(ctx, List<IMendixObject>)`; `Core.commitWithoutEvents(...)` | Uncommitted objects vanish after the request |
| Delete | `Core.delete(getContext(), obj)` | Delete behaviour of associations still applies |
| Retrieve | `Core.createXPathQuery("//Sales.Order[Sales.Order_Customer = $c]").setVariable("c", customer.getMendixObject()).execute(ctx)`; proxy: `Order.load(ctx, "[Total > 100]")` | Never concatenate user input into XPath; use `$variables` |
| Retrieve by id | `Core.retrieveId(ctx, identifier)`; proxy getter of an association loads the other object | |
| Call microflow | Proxy: `sales.proxies.microflows.Microflows.sUB_Order_Validate(ctx, order)`; builder: `Core.microflowCall("Sales.SUB_Order_Validate").withParam("Order", order.getMendixObject()).execute(ctx)` | `withParam` name = microflow parameter name |
| Transaction | The action runs inside the calling microflow's transaction. An exception rolls back the whole microflow (unless its error handler catches it) | Do not open your own transaction |
| Logging | `Core.getLogger("Sales").info("…")` (`ILogNode`: `trace/debug/info/warning/error/critical`) | Use one log node per module |
| Errors | Throw `com.mendix.systemwideinterfaces.MendixRuntimeException` or `IllegalArgumentException` with a clear message | The message shows in the microflow error handler as `$latestError/Message` |
| Return Boolean | Return `true`/`false`, never `null` | |

## 2. Define the action

In Studio Pro: **App Explorer > module > Add other > Java action**. Set parameters, return type, and (optionally)
**Expose as microflow action** (caption + category). Then click **App > Deploy for Eclipse** (or run the app)
so the `.java` file and the proxies are generated.

With dump-it, one op creates the action and its file (byte-for-byte as Studio Pro writes it):

```json
{ "ops": [ { "op": "createJavaAction", "module": "Sales", "name": "JA_CreateOrder",
  "parameters": [
    { "name": "Customer", "type": "Sales.Customer" },
    { "name": "Tags", "type": "List(Sales.Tag)" },
    { "name": "Number", "type": "String" },
    { "name": "Total", "type": "Decimal" },
    { "name": "AfterCreate", "type": "Microflow" } ],
  "returns": "Sales.Order",
  "exposed": { "caption": "Create order", "category": "Sales" } } ] }
```

## 3. Generated skeleton (Mendix 10.24, exact)

This is what Studio Pro 10.24 generates for the action above. **Do not change anything outside the kept regions.**

```java
// This file was generated by Mendix Studio Pro.
//
// WARNING: Only the following code will be retained when actions are regenerated:
// - the import list
// - the code between BEGIN USER CODE and END USER CODE
// - the code between BEGIN EXTRA CODE and END EXTRA CODE
// Other code you write will be lost the next time you deploy the project.
// Special characters, e.g., é, ö, à, etc. are supported in comments.

package sales.actions;

import com.mendix.systemwideinterfaces.core.IContext;
import com.mendix.systemwideinterfaces.core.IMendixObject;
import com.mendix.systemwideinterfaces.core.UserAction;

public class JA_CreateOrder extends UserAction<IMendixObject>
{
	/** @deprecated use Customer.getMendixObject() instead. */
	@java.lang.Deprecated(forRemoval = true)
	private final IMendixObject __Customer;
	private final sales.proxies.Customer Customer;
	/** @deprecated use com.mendix.utils.ListUtils.map(Tags, com.mendix.systemwideinterfaces.core.IEntityProxy::getMendixObject) instead. */
	@java.lang.Deprecated(forRemoval = true)
	private final java.util.List<IMendixObject> __Tags;
	private final java.util.List<sales.proxies.Tag> Tags;
	private final java.lang.String Number;
	private final java.math.BigDecimal Total;
	private final java.lang.String AfterCreate;

	public JA_CreateOrder(
		IContext context,
		IMendixObject _customer,
		java.util.List<IMendixObject> _tags,
		java.lang.String _number,
		java.math.BigDecimal _total,
		java.lang.String _afterCreate
	)
	{
		super(context);
		this.__Customer = _customer;
		this.Customer = _customer == null ? null : sales.proxies.Customer.initialize(getContext(), _customer);
		this.__Tags = _tags;
		this.Tags = java.util.Optional.ofNullable(_tags)
			.orElse(java.util.Collections.emptyList())
			.stream()
			.map(tagsElement -> sales.proxies.Tag.initialize(getContext(), tagsElement))
			.collect(java.util.stream.Collectors.toList());
		this.Number = _number;
		this.Total = _total;
		this.AfterCreate = _afterCreate;
	}

	@java.lang.Override
	public IMendixObject executeAction() throws Exception
	{
		// BEGIN USER CODE
		throw new com.mendix.systemwideinterfaces.MendixRuntimeException("Java action was not implemented");
		// END USER CODE
	}

	/**
	 * Returns a string representation of this action
	 * @return a string representation of this action
	 */
	@java.lang.Override
	public java.lang.String toString()
	{
		return "JA_CreateOrder";
	}

	// BEGIN EXTRA CODE
	// END EXTRA CODE
}
```

Notes:
- An object return type is `IMendixObject`. Return `order.getMendixObject()`, not the proxy.
- A list return type is `java.util.List<IMendixObject>`.
- Add imports to the import list at the top (they are kept). Fully qualified names inside user code also work.

## 4. Naming of generated proxy members

Domain model: `Sales.Order` (Number: String, Total: Decimal, Status: Enum `Sales.OrderStatus`),
`Sales.Order_Customer` (reference, owner Order → Customer), `Sales.Order_Tag` (reference set, owner Order → Tag).

| Model element | Proxy getter | Proxy setter | `MemberNames` constant |
|---|---|---|---|
| Attribute `Number` | `getNumber()` | `setNumber(String)` | `Order.MemberNames.Number` |
| Decimal `Total` | `getTotal()` → `BigDecimal` | `setTotal(BigDecimal)` | `Order.MemberNames.Total` |
| Enum `Status` | `getStatus()` → `sales.proxies.OrderStatus` | `setStatus(OrderStatus)` | `Order.MemberNames.Status` |
| Reference `Sales.Order_Customer` | `getOrder_Customer()` → `Customer` (throws `CoreException`) | `setOrder_Customer(Customer)` | `Order.MemberNames.Order_Customer` → `"Sales.Order_Customer"` |
| Reference set `Sales.Order_Tag` | `getOrder_Tag()` → `List<Tag>` | `setOrder_Tag(List<Tag>)` | `Order.MemberNames.Order_Tag` |

Every getter and setter also exists with a context first: `setNumber(IContext, String)`. Use that form with a sudo
context. `Order.entityName` is `"Sales.Order"`. `MemberNames.X.toString()` gives the stored member name.

## 5. Recipes

### 5.1 Create an object, set attributes, commit

```java
// BEGIN USER CODE
sales.proxies.Order order = new sales.proxies.Order(getContext());
order.setNumber(Number);
order.setTotal(Total == null ? java.math.BigDecimal.ZERO : Total);
order.setStatus(sales.proxies.OrderStatus.Open);
com.mendix.core.Core.commit(getContext(), order.getMendixObject());
return order.getMendixObject();
// END USER CODE
```

Without proxies (generic code, entity name from an Entity parameter):

```java
IMendixObject obj = com.mendix.core.Core.instantiate(getContext(), ResultEntity); // e.g. "Sales.Order"
obj.setValue(getContext(), "Number", "A-100");
obj.setValue(getContext(), "Total", new java.math.BigDecimal("12.50"));
obj.setValue(getContext(), "Status", "Open");          // enum = key as String
com.mendix.core.Core.commit(getContext(), obj);
```

### 5.2 Set a reference (one object)

Set it on the **owner** side (the entity that holds the association, here Order).

```java
order.setOrder_Customer(Customer);                     // proxy
order.setOrder_Customer(null);                         // clear it
// raw:
obj.setValue(getContext(), "Sales.Order_Customer", Customer.getMendixObject().getId());
```

### 5.3 Set, add to, or remove from a reference set

The setter replaces the whole set. To add, read the current list first.

```java
// replace
order.setOrder_Tag(Tags);

// add (keep the current tags)
java.util.List<sales.proxies.Tag> current = new java.util.ArrayList<>(order.getOrder_Tag());
for (sales.proxies.Tag t : Tags) if (!current.contains(t)) current.add(t);
order.setOrder_Tag(current);

// remove
java.util.List<sales.proxies.Tag> left = new java.util.ArrayList<>(order.getOrder_Tag());
left.removeAll(Tags);
order.setOrder_Tag(left);

// raw
java.util.List<com.mendix.systemwideinterfaces.core.IMendixIdentifier> ids = new java.util.ArrayList<>();
for (sales.proxies.Tag t : Tags) ids.add(t.getMendixObject().getId());
obj.setValue(getContext(), "Sales.Order_Tag", ids);
```

### 5.4 Retrieve with XPath (safe variables, sort, limit)

```java
java.util.List<IMendixObject> rows = com.mendix.core.Core
	.createXPathQuery("//Sales.Order[Sales.Order_Customer = $customer][Total >= $min]")
	.setVariable("customer", Customer.getMendixObject())   // an object compares by id
	.setVariable("min", new java.math.BigDecimal("100"))
	.setAmount(10)
	.setOffset(0)
	.addSort("Total", false)        // false = descending
	.execute(getContext());

// proxy shortcut (constant constraint only)
java.util.List<sales.proxies.Order> open = sales.proxies.Order.load(getContext(), "[Status = 'Open']");
```

Do not build XPath by concatenating user input. Use `$name` plus `setVariable`. An object variable
(`IMendixObject`) compares an association by id. 10.24 proxies have no `getGUID()`; use `getMendixObject()`
or `getMendixObject().getId()`.

### 5.5 Retrieve over an association

```java
sales.proxies.Customer c = order.getOrder_Customer();          // reference: owner → other side
java.util.List<sales.proxies.Tag> tags = order.getOrder_Tag(); // reference set
// reverse direction (all orders of a customer): use XPath, see 5.4
```

### 5.6 Call a microflow

```java
// a) generated proxy (Studio Pro creates <module>.proxies.microflows.Microflows)
boolean ok = sales.proxies.microflows.Microflows.sUB_Order_Validate(getContext(), order);

// b) builder (works for any name, also a Microflow parameter)
Object result = com.mendix.core.Core.microflowCall("Sales.SUB_Order_Validate")
	.withParam("Order", order.getMendixObject())   // parameter name as in the microflow
	.execute(getContext());
boolean ok2 = Boolean.TRUE.equals(result);

// c) the Microflow parameter of this action (AfterCreate holds the microflow name)
com.mendix.core.Core.microflowCall(AfterCreate)
	.withParam("Order", order.getMendixObject())
	.execute(getContext());
```

Proxy method names start lower-case: `SUB_Order_Validate` → `sUB_Order_Validate`, `ACT_Pay` → `aCT_Pay`.
Pass objects as `IMendixObject` to `withParam`. Primitive parameters take `String`, `Long`, `BigDecimal`, `Boolean`, `Date`.

### 5.7 Delete

```java
com.mendix.core.Core.delete(getContext(), order.getMendixObject());
```

### 5.8 Run with more rights

```java
IContext sudo = getContext().createSudoClone();          // same user, no entity access checks
java.util.List<IMendixObject> all = com.mendix.core.Core.createXPathQuery("//Sales.Order").execute(sudo);
```

Use sudo only for a clear reason. Default to `getContext()`.

### 5.9 Logging and errors

```java
// BEGIN EXTRA CODE
private static final com.mendix.logging.ILogNode LOG = com.mendix.core.Core.getLogger("Sales");
// END EXTRA CODE

// BEGIN USER CODE
if (Customer == null) throw new IllegalArgumentException("Customer is required");
LOG.info("Creating order " + Number + " for " + Customer.getName());
// END USER CODE
```

## 6. Call the Java action from a microflow

Studio Pro: drag **Call Java action** (or the exposed action from the Toolbox) into the microflow, map each parameter
to a variable or expression, and set the output variable.

dump-it step (inside `createMicroflow` / `addActions`):

```json
{ "action": "callJava", "javaAction": "Sales.JA_CreateOrder", "variable": "NewOrder",
  "args": { "Customer": "$Customer", "Tags": "$Tags", "Number": "'A-100'", "Total": "$Total",
            "AfterCreate": "Sales.SUB_Order_Validate" } }
```

## 7. Few-shot examples (request → code)

### Example A - "Create an order for a customer, tag it, and commit"

Action: `Sales.JA_CreateOrder(Customer: Sales.Customer, Tags: List(Sales.Tag), Number: String, Total: Decimal) → Sales.Order`

```java
// BEGIN USER CODE
if (Customer == null) throw new IllegalArgumentException("Customer is required");
sales.proxies.Order order = new sales.proxies.Order(getContext());
order.setNumber(Number);
order.setTotal(Total == null ? java.math.BigDecimal.ZERO : Total);
order.setOrder_Customer(Customer);
order.setOrder_Tag(Tags);
com.mendix.core.Core.commit(getContext(), order.getMendixObject());
return order.getMendixObject();
// END USER CODE
```

### Example B - "Sum the totals of a customer's open orders" (retrieve + aggregate)

Action: `Sales.JA_OpenTotal(Customer: Sales.Customer) → Decimal`

```java
// BEGIN USER CODE
java.util.List<IMendixObject> orders = com.mendix.core.Core
	.createXPathQuery("//Sales.Order[Sales.Order_Customer = $c][Status = 'Open']")
	.setVariable("c", Customer.getMendixObject())
	.execute(getContext());
java.math.BigDecimal sum = java.math.BigDecimal.ZERO;
for (IMendixObject o : orders) {
	java.math.BigDecimal t = o.getValue(getContext(), "Total");
	if (t != null) sum = sum.add(t);
}
return sum;
// END USER CODE
```

### Example C - "Validate each order with a microflow; mark failures"

Action: `Sales.JA_ValidateAll(Orders: List(Sales.Order)) → Integer` (number of failures)

```java
// BEGIN USER CODE
long failed = 0;
java.util.List<IMendixObject> changed = new java.util.ArrayList<>();
for (sales.proxies.Order o : Orders) {
	boolean ok = sales.proxies.microflows.Microflows.sUB_Order_Validate(getContext(), o);
	if (!ok) {
		o.setStatus(sales.proxies.OrderStatus.Invalid);
		changed.add(o.getMendixObject());
		failed++;
	}
}
if (!changed.isEmpty()) com.mendix.core.Core.commit(getContext(), changed);
return failed;
// END USER CODE
```

### Example D - generic: "Create N objects of any entity and initialize each with a microflow"

Type parameter `T`. Action: `Generic.JA_CreateMany(ResultEntity: EntityType(T), Count: Integer, Init: Microflow) → List(T)`

```java
// BEGIN USER CODE
java.util.List<IMendixObject> result = new java.util.ArrayList<>();
for (long i = 0; i < Count; i++) {
	IMendixObject obj = com.mendix.core.Core.instantiate(getContext(), ResultEntity);
	com.mendix.core.Core.microflowCall(Init)
		.withParam("Item", obj)
		.inTransaction(true)
		.execute(getContext());
	result.add(obj);
}
return result;
// END USER CODE
```

## 8. Mistakes to avoid

| Mistake | Result | Do this instead |
|---|---|---|
| Code outside the BEGIN/END regions | Lost on next deploy | Put helpers in EXTRA CODE, imports at the top |
| `obj.setValue(ctx, "Order_Customer", customerObject)` | Runtime error | Qualified name + `getId()`: `"Sales.Order_Customer", customer.getId()` |
| Setting the association on the non-owner side | Nothing changes / error | Set it on the owner entity |
| Assuming the reference-set setter adds | Existing items are removed | Read, modify, then set the list |
| Forgetting `Core.commit` | Object is lost after the request | Commit, or return it and commit in the microflow |
| Committing inside a loop one by one | Slow | Collect and commit a list once |
| `double` for Decimal | Rounding errors | `BigDecimal` |
| String-concatenated XPath with user input | XPath injection | `$variables` + `setVariable` |
| `Core.createSystemContext()` by default | Bypasses security and user | `getContext()`; sudo only when needed |
| Editing proxy files | Overwritten on deploy | Change the domain model instead |
| Optional Microflow/Entity parameter | Not possible in 10.24.13 (from 10.24.22) | Make it required, or pass an empty string and check it |
| Returning `null` for Boolean | Microflow error | Return `true`/`false` |
| Catching and hiding exceptions | Microflow continues with bad data | Log and rethrow, or return a clear status |

## 9. Checklist before you finish

1. The action definition (parameters, return type) matches the code's fields and return type.
2. All code is inside the kept regions; new imports are in the import list.
3. Associations are set on the owner side with the right setter (reference vs reference set).
4. Every created or changed object is committed (here or in the calling microflow).
5. XPath uses `$variables`; no user input is concatenated.
6. Microflow calls use the exact parameter names of that microflow.
7. The right context is used (`getContext()` by default).
8. The microflow that calls the action maps every required parameter and handles errors (error handler on the call if needed).
9. In Studio Pro: deploy once so proxies exist, then compile (Errors pane empty).

Sources: Mendix 10 docs (Java Actions, Java API tutorial, Build Microflow Actions with Java, Data Storage APIs),
release notes 10.24 (optional Microflow/Entity parameters from 10.24.22), and Java files generated by Studio Pro 10.24
in public test projects.
