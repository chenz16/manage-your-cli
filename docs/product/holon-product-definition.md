# Holon Product Definition

Status: draft
Date: 2026-05-15

## One-Line Definition

Holon is a hybrid workforce platform where every person or team runs a lightweight local agent team, and those teams connect through cloud-managed proxy employees.

## Product Thesis

The future workplace will not be only human teams using chatbots, and it will not be only autonomous AI agent swarms. The durable model is a hybrid workforce:

```text
real people
  + local AI teams
  + proxy employees
  + cloud coordination
  + auditable handoffs
```

Each desk should be capable of building its own small team. That team can include local virtual agents, peer mirrors of real people's desks, and temporary helpers for scoped tasks. The local team remains simple and shallow. Larger organizational complexity comes from connecting many desks together.

## Why Holon

A holon is something that is both a whole and a part.

That maps directly to the product:

- each desk is a whole team
- each desk is also a node in a larger organization
- each person owns their local accountability boundary
- each team can delegate to other teams without exposing its internal details

Holon should feel like a connected workforce system, not an agent graph editor.

## Core Model

### Node

A node is one local Holon desk install or hosted Holon desk owned by a real person or team.

It contains:

- owner profile
- local staff roster
- inbound mission inbox
- outbound assignments
- deliverable history
- connection tokens
- runtime adapters
- local policy and budgets

The node should be easy to run locally or connect to the cloud service.

### Local Team

Every node can build a local team.

The team is intentionally shallow:

```text
Owner
  -> local AI staff
  -> proxy staff
  -> temporary task helpers
```

The owner should not have to manage a deep internal org chart. The desk should make it easy to create, configure, pause, archive, and replace members.

### Local AI Staff

Local AI staff execute assignments through a runtime adapter.

In `manage-your-cli`, the shipping runtime adapter is the **direct multi-CLI adapter** — claude / codex / gemini / qwen, running on the user's own CLI subscription. (Sister-repo lineage `holon-engineering` shipped a Hermes adapter; `manage-your-cli` has no Hermes adapter — see ADR-040.) Future adapters can include:

- OpenAI Agents SDK
- additional CLI binaries beyond the four above
- browser automation workers
- direct LLM runners
- company-specific tool runners

Local AI staff do not own durable product state. They execute bounded assignments and return events or deliverables.

### Proxy Staff

Proxy staff are local staff identities that represent another real person or remote Holon node.

Example:

```text
小王
Media Research Proxy
Runs through: Wang's Desk
```

When the owner assigns work to proxy staff:

1. the local node creates an outbound assignment
2. the cloud/local connector sends a mission to the remote node
3. the remote person receives it in their own inbox
4. the remote node can execute locally, manually, or delegate further
5. the returned deliverable attaches to the original assignment

### Mission

A mission is an inbound task from another person or node.

Required lifecycle:

```text
queued -> accepted -> in_progress -> submitted
queued -> rejected
in_progress -> blocked
submitted -> returned_to_origin
```

The mission inbox is the key human participation surface. It should make accountability clear:

- who sent the mission
- what outcome is requested
- what context is included
- what deadline or urgency applies
- what actions are available

### Assignment

An assignment is local work owned by the node.

Assignments can be routed to:

- local AI staff
- proxy staff
- the owner
- future scheduled workflows

Assignments should preserve routing metadata so the owner can tell whether work is local, remote, waiting, failed, or returned.

### Deliverable

A deliverable is the durable output of work.

Deliverables are not just chat messages. They should be attached to assignments and missions.

Minimum fields:

- title
- body or file references
- source assignment
- author node or staff
- created time
- optional context/citations

## Product Architecture

Holon has two major surfaces:

```text
Cloud service
  - identity
  - connection registry
  - secure relay
  - policy
  - retries
  - audit
  - hosted nodes for teams that want cloud-only use

Local app
  - local team management
  - local context/tools
  - local AI runtime adapters
  - mission inbox
  - assignment/deliverable UI
  - connector to cloud relay
```

The cloud service should make connection reliable. The local app should preserve autonomy and local execution.

## Core Protocol

The minimum protocol is mission dispatch and completion return.

### Dispatch

```text
A assigns work to proxy staff
  -> A sends mission to B
  -> B receives mission in inbox
  -> B accepts, rejects, executes, or forwards
```

### Completion

```text
B submits deliverable
  -> B calls back to A
  -> A validates connection
  -> A attaches deliverable to original assignment
  -> A marks assignment completed
```

### Health

Connections need visible health:

- online/offline
- last seen
- last successful handoff
- retrying
- failed
- revoked

Silent failure is not acceptable in a workplace product.

## UX Principles

1. The owner manages outcomes, not agent graphs.
2. Local teams are shallow and easy to understand.
3. Proxy staff must be visibly connected to real people or remote teams.
4. Every handoff needs a clear owner, state, and returned artifact.
5. The cloud should feel like a connector and reliability layer, not a black box that owns all work.
6. Human accountability should always be visible.

## Primary Screens

### Today

Shows the owner's active work.

Required states:

- local AI running
- remote proxy waiting
- inbound mission pending
- deliverable returned
- blocked
- retrying

### Inbound

The mission inbox for tasks sent by other people or teams.

Required actions:

- accept
- reject
- ask question
- delegate locally
- submit deliverable

### Staff

Manage local AI staff and proxy staff.

Staff should be grouped by type:

- local AI
- proxy people
- system defaults
- archived

### Connections

Manage cloud and peer connections.

Required actions:

- generate inbound token
- connect proxy staff to a remote node
- test connection
- revoke connection
- rotate token
- view status

### Deliverables

Shows local and returned work.

Required groups:

- local AI deliverables
- remote proxy deliverables
- deliverables submitted upstream

## Positioning

Short positioning:

```text
Local human-AI teams that connect into a larger hybrid workforce network.
```

Commercial positioning:

```text
Holon helps teams build lightweight local AI workforces and connect them through real people, proxy employees, and cloud-managed handoffs.
```

Developer positioning:

```text
A framework for local agent teams, proxy staff, and human-owned mission handoffs.
```

## Differentiation

### Versus centralized agent builders

Centralized builders focus on making agents inside one workspace.

Holon focuses on connecting many human-owned local teams while preserving each team's own context and accountability boundary.

### Versus generic automation platforms

Automation platforms connect apps.

Holon connects people, local agents, proxy staff, missions, and deliverables.

### Versus chat assistants

Chat assistants answer inside one conversation.

Holon routes work across a hybrid workforce and preserves ownership, status, and returned artifacts.

## Non-Goals For MVP

- deep local agent hierarchy
- public agent marketplace
- full enterprise admin suite
- payment/revenue sharing between nodes
- complex org chart visualization
- custom model training
- generic workflow builder
- conversation / chat session primitive (task-only model in V1; conversation evaluated in V2 based on user research — see ADR-009)

## Success Metrics

Prototype:

- two nodes complete dispatch and return in under five minutes
- a user can configure proxy staff without reading protocol docs
- remote failure is visible
- deliverable returns to the original assignment

Product:

- active proxy connections per node
- completed cross-node missions
- inbound mission acceptance rate
- median time to returned deliverable
- dispatch failure/retry rate
- percentage of work completed locally versus remotely

