"use strict";
// The example domain every template's "example" slots use: the catalog prints it, scripts/check-screens.js applies it
// to a copy of a test project and then runs every template's example.
const M = "MyFirstModule";
const E = n => `${M}.${n}`;
const S = (name, len = 100) => ({ name, type: `String(${len})` });
const enumOp = (name, values) => ({ op: "createEnumeration", module: M, name, values });
const entity = (name, attributes, extra = {}) => ({ op: "createEntity", module: M, name, attributes, ...extra });
const assoc = (from, to) => ({ op: "addAssociation", from: E(from), to: E(to) });

const FIXTURE = [
    enumOp("EmpStatus", ["Active", "OnLeave", "Left"]),
    enumOp("EntryKind", ["Work", "Break", "Travel"]),
    enumOp("ReqStatus", ["Draft", "Submitted", "Approved", "Rejected"]),
    enumOp("LeaveType", ["Vacation", "Sick", "Unpaid"]),
    enumOp("Segment", ["Small", "Medium", "Enterprise"]),
    enumOp("Stage", ["Lead", "Qualified", "Proposal", "Won", "Lost"]),
    enumOp("OrderStatus", ["New", "Paid", "Shipped", "Delivered", "Cancelled"]),
    enumOp("Priority", ["Low", "Normal", "High", "Urgent"]),
    entity("Employee", [S("FullName"), S("Email", 200), S("Department"), S("Phone", 30), { name: "StartDate", type: "DateTime" }, { name: "Salary", type: "Decimal" },
        { name: "Remote", type: "Boolean" }, { name: "Status", type: `Enum(${E("EmpStatus")})` }, { name: "Notes", type: "String(unlimited)" }]),
    entity("TimeEntry", [{ name: "ClockIn", type: "DateTime" }, { name: "ClockOut", type: "DateTime" }, { name: "Hours", type: "Decimal" }, { name: "Kind", type: `Enum(${E("EntryKind")})` }, S("Note", 200)]),
    assoc("TimeEntry", "Employee"),
    entity("LeaveRequest", [S("Reason", 200), { name: "FromDate", type: "DateTime" }, { name: "ToDate", type: "DateTime" }, { name: "Days", type: "Decimal" },
        { name: "Status", type: `Enum(${E("ReqStatus")})` }, { name: "LeaveKind", type: `Enum(${E("LeaveType")})` }]),
    assoc("LeaveRequest", "Employee"),
    entity("Shift", [S("Role"), { name: "StartTime", type: "DateTime" }, { name: "EndTime", type: "DateTime" }]),
    assoc("Shift", "Employee"),
    entity("Customer", [S("Name"), S("Email", 200), S("Phone", 30), S("City"), { name: "Segment", type: `Enum(${E("Segment")})` }, { name: "Revenue", type: "Decimal" }, { name: "Active", type: "Boolean" }]),
    entity("Opportunity", [S("Title", 200), { name: "Amount", type: "Decimal" }, { name: "Stage", type: `Enum(${E("Stage")})` }, { name: "CloseDate", type: "DateTime" }, { name: "Probability", type: "Integer" }]),
    assoc("Opportunity", "Customer"),
    entity("Product", [S("Name"), S("Sku", 40), { name: "Price", type: "Decimal" }, { name: "Stock", type: "Integer" }, S("Category"), { name: "Active", type: "Boolean" }]),
    entity("SalesOrder", [S("Number", 40), { name: "OrderDate", type: "DateTime" }, { name: "Total", type: "Decimal" }, { name: "Status", type: `Enum(${E("OrderStatus")})` }]),
    assoc("SalesOrder", "Customer"),
    entity("OrderLine", [{ name: "Quantity", type: "Integer" }, { name: "Price", type: "Decimal" }, S("Description", 200)]),
    assoc("OrderLine", "SalesOrder"),
    assoc("OrderLine", "Product"),
    entity("WorkTask", [S("Title", 200), { name: "Description", type: "String(unlimited)" }, { name: "DueDate", type: "DateTime" }, { name: "TaskPriority", type: `Enum(${E("Priority")})` }, { name: "Done", type: "Boolean" }]),
    entity("Notice", [S("Message", 500), { name: "CreatedOn", type: "DateTime" }, { name: "Seen", type: "Boolean" }]),
    entity("Attachment", [S("Title", 200), S("Category")], { generalization: "System.FileDocument" }),
    ...["Employee", "TimeEntry", "LeaveRequest", "Shift", "Customer", "Opportunity", "Product", "SalesOrder", "OrderLine", "WorkTask", "Notice", "Attachment"]
        .map(n => ({ op: "addAccessRule", entity: E(n), roles: [`${M}.User`], access: "ReadWrite", create: true, delete: true }))
];

module.exports = { FIXTURE, M, E };
