# ADR-0001: Clean Architecture boundaries

**Status:** Accepted

Wharness separates domain/application logic from HTTP, provider, filesystem, and Docker adapters to keep security and execution policy testable and replaceable.
