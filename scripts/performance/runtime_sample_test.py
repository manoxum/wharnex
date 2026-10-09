import unittest

from runtime_sample import process_stat, resources


class RuntimeSampleTests(unittest.TestCase):
    def test_parses_cpu_rss_and_parent_without_command_arguments(self):
        fields = ["0"] * 22
        fields[0], fields[1], fields[11], fields[12] = "S", "10", "42", "8"
        fields[17], fields[19], fields[21] = "4", "100", "20"
        parsed = process_stat("25 (worker ) name) " + " ".join(fields))
        self.assertEqual(parsed["name"], "worker ) name")
        self.assertEqual((parsed["pid"], parsed["ppid"], parsed["ticks"]), (25, 10, 50))
        self.assertEqual(parsed["threads"], 4)
        self.assertEqual(parsed["state"], "S")

    def test_reused_pids_and_new_processes_do_not_inflate_cpu(self):
        old = {"pid": 25, "ppid": 10, "name": "worker", "state": "S", "started": 100,
               "ticks": 100, "threads": 2, "rss_bytes": 1 << 20}
        new = {**old, "ticks": 150}
        row = resources({25: old}, {25: new}, 0.5, 100)[0]
        self.assertEqual(row["cpu_percent"], 100)
        self.assertEqual(row["rss_mib"], 1)
        self.assertEqual(resources({25: old}, {25: {**new, "started": 200}}, 0.5, 100)[0]["cpu_percent"], 0)
        self.assertEqual(resources({}, {25: new}, 0.5, 100)[0]["cpu_percent"], 0)


if __name__ == "__main__":
    unittest.main()
