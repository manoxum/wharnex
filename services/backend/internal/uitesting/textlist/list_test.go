package textlist

import (
	"encoding/json"
	"reflect"
	"testing"
)

func TestTextListAcceptsStringsAndFlatObjects(t *testing.T) {
	var test struct {
		ID       string `json:"id"`
		TestData List   `json:"test_data"`
		Tags     List   `json:"tags"`
	}
	raw := `{"id":"x","test_data":["simples",{"valor":"WHX 1","campo":"Nome"},42,{"vazio":null}],"tags":null}`
	if err := json.Unmarshal([]byte(raw), &test); err != nil {
		t.Fatal(err)
	}
	if want := (List{"simples", "campo: Nome; valor: WHX 1", "42", ""}); !reflect.DeepEqual(test.TestData, want) {
		t.Fatalf("test_data=%q", test.TestData)
	}
	for _, bad := range []string{`{"test_data":[{"a":{"b":1}}]}`, `{"test_data":[[1]]}`, `{"test_data":"x"}`} {
		if err := json.Unmarshal([]byte(bad), &test); err == nil {
			t.Fatalf("%s accepted", bad)
		}
	}
}
