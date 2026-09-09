package app

import (
	"context"
	"testing"
	"time"
)

func TestSetCapacityAdmitsAlreadyWaitingPlans(t *testing.T) {
	queue := newProjectExecutionQueue()
	queue.setCapacity(1)
	first, err := queue.acquire(context.Background(), "/p", "s1")
	if err != nil {
		t.Fatal(err)
	}
	admitted := make(chan struct{})
	go func() {
		ticket, acquireErr := queue.acquire(context.Background(), "/p", "s2")
		if acquireErr == nil {
			defer ticket.release()
			close(admitted)
		}
	}()
	select {
	case <-admitted:
		t.Fatal("the second plan must wait while capacity is one")
	case <-time.After(50 * time.Millisecond):
	}
	// Raising capacity must benefit a plan that is ALREADY waiting, not only
	// plans submitted afterwards.
	queue.setCapacity(2)
	select {
	case <-admitted:
	case <-time.After(2 * time.Second):
		t.Fatal("raising capacity did not admit the waiting plan")
	}
	first.release()
}

func TestLoweredCapacityDoesNotInterruptRunningWorkAndDrains(t *testing.T) {
	queue := newProjectExecutionQueue()
	queue.setCapacity(2)
	first, err := queue.acquire(context.Background(), "/p", "s1")
	if err != nil {
		t.Fatal(err)
	}
	second, err := queue.acquire(context.Background(), "/p", "s2")
	if err != nil {
		t.Fatal(err)
	}
	// Both are already running; lowering the limit must not interrupt either.
	queue.setCapacity(1)
	admitted := make(chan struct{})
	go func() {
		ticket, acquireErr := queue.acquire(context.Background(), "/p", "s3")
		if acquireErr == nil {
			defer ticket.release()
			close(admitted)
		}
	}()
	first.release()
	// One slot freed, but the project is still at the new limit of one.
	select {
	case <-admitted:
		t.Fatal("admitted a plan while the project was still over capacity")
	case <-time.After(50 * time.Millisecond):
	}
	second.release()
	select {
	case <-admitted:
	case <-time.After(2 * time.Second):
		t.Fatal("queue did not drain after returning under capacity")
	}
}

func TestSetCapacityClampsToSupportedRange(t *testing.T) {
	queue := newProjectExecutionQueue()
	if applied := queue.setCapacity(0); applied != 1 {
		t.Fatalf("expected a floor of 1, got %d", applied)
	}
	if applied := queue.setCapacity(9999); applied != maxProjectExecutionConcurrency {
		t.Fatalf("expected clamping to %d, got %d", maxProjectExecutionConcurrency, applied)
	}
}
