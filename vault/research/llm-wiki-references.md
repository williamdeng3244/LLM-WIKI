---
title: LLM wiki references
tags: [research, references]
---

# LLM wiki references

Background reading that shaped this system.

## Karpathy llm-wiki

Markdown-only, agent-maintained. We borrowed the [[wiki-link]] pattern and the principle that agents propose rather than publish. See [[product/personal-agents]].

## Obsidian

Local-first markdown with a graph view. We borrowed the file structure (folders as categories) and the force-directed graph as a navigation primitive.

## PandaWiki

AI-driven knowledge base with semantic search and Q&A. We borrowed the multi-source ingestion idea (web pages, files) for future expansion — see [[product/roadmap]].

## What we did differently

- Database-as-source-of-truth so hundreds of users don't fight over file locks
- Per-page stability levels (open/stable/locked) so the trust model is explicit
- Personal agents as first-class users, not a separate subsystem

#research
