use conduit_core::evaluate_json;
use serde::Deserialize;
use serde_json::Value;

#[derive(Debug, Deserialize)]
struct Fixture {
    name: String,
    action: Value,
    expected: Value,
}

#[test]
fn domain_fixtures_match() {
    let fixtures: Vec<Fixture> =
        serde_json::from_str(include_str!("fixtures/domain.json")).unwrap();
    for fixture in fixtures {
        let response: Value =
            serde_json::from_str(&evaluate_json(&fixture.action.to_string())).unwrap();
        assert_eq!(response["ok"], true, "{}", fixture.name);
        assert_eq!(response["value"], fixture.expected, "{}", fixture.name);
    }
}
